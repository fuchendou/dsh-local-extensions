"""Own the fixed Linux execution units and file exchange for personal tasks."""

import base64
import fcntl
import json
import os
import pwd
import re
import stat
import subprocess
import threading
import time
import uuid

from file_exchange import MAX_BYTES, read_output, stage_input
from systemd_task import task_unit, unit_arguments


_PREFIX = b'DSH-ISOLATION-1 '
_MAX_RESPONSE = 32 * 1024 * 1024
_TOOLS = frozenset(('read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill',
                    'office_status', 'attachment_text'))


def _systemctl(*args, timeout=15, check=True):
    return subprocess.run(['systemctl', *args], check=check, timeout=timeout, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True).stdout.strip()


def _verify_process(unit, rootfs, account, mode):
    values = {}
    for line in _systemctl('show', unit, '-p', 'MainPID', '-p', 'PrivateNetwork', '-p', 'PrivateIPC',
                           '-p', 'PrivateDevices', '-p', 'PrivateTmp', '-p', 'ProtectProc', '-p', 'NoNewPrivileges',
                           '-p', 'InvocationID').splitlines():
        key, _, value = line.partition('=')
        values[key] = value
    if any(values.get(name) != 'yes' for name in ('PrivateNetwork', 'PrivateIPC', 'PrivateDevices', 'PrivateTmp', 'NoNewPrivileges')):
        raise RuntimeError('required systemd isolation property is unavailable')
    if values.get('ProtectProc') != 'invisible':
        raise RuntimeError('process isolation is unavailable')
    pid = int(values.get('MainPID', '0'))
    if pid <= 1:
        raise RuntimeError('isolated worker did not start')
    with open(f'/proc/{pid}/status', encoding='utf-8') as file:
        status = dict(line.rstrip().split(':', 1) for line in file if ':' in line)
    uids = [int(value) for value in status.get('Uid', '').split()]
    if len(uids) != 4 or any(uid != account.pw_uid for uid in uids):
        raise RuntimeError('worker identity does not match its slot')
    if status.get('NoNewPrivs', '').strip() != '1' or int(status.get('CapEff', '1').strip(), 16) != 0:
        raise RuntimeError('worker privilege restrictions are unavailable')
    for namespace in ('net', 'ipc', 'mnt'):
        if os.readlink(f'/proc/{pid}/ns/{namespace}') == os.readlink(f'/proc/1/ns/{namespace}'):
            raise RuntimeError('worker namespace isolation is unavailable')
    actual, expected = os.stat(f'/proc/{pid}/root'), os.stat(rootfs)
    if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
        raise RuntimeError('worker root does not match its isolated root')
    with open(f'/proc/{pid}/mountinfo', encoding='utf-8') as file:
        mounts = [line.split() for line in file if line.split()[4] in ('/work', '/materials')]
    work = [mount for mount in mounts if mount[4] == '/work']
    materials = [mount for mount in mounts if mount[4] == '/materials']
    expected_access = 'ro' if mode == 'read-only' else 'rw'
    if len(work) != 1 or expected_access not in work[0][5].split(','):
        raise RuntimeError('workspace mount does not match the requested mode')
    if len(materials) != 1 or 'ro' not in materials[0][5].split(','):
        raise RuntimeError('materials mount is not read-only')
    invocation = values.get('InvocationID', '')
    if re.fullmatch(r'[a-f0-9]{32}', invocation) is None:
        raise RuntimeError('worker invocation identity is unavailable')
    return pid, invocation


def _chown_tree(directory, uid, gid, device, budget=None, depth=0):
    if depth > 64:
        raise RuntimeError('workspace directory nesting exceeds its limit')
    if budget is None:
        budget = [100_000]
    with os.scandir(directory) as entries:
        names = []
        for entry in entries:
            budget[0] -= 1
            if budget[0] < 0:
                raise RuntimeError('workspace entry count exceeds its limit')
            names.append(entry.name)
    for name in names:
        info = os.stat(name, dir_fd=directory, follow_symlinks=False)
        if info.st_dev != device:
            raise RuntimeError('workspace contains a foreign mount')
        if stat.S_ISLNK(info.st_mode):
            os.chown(name, uid, gid, dir_fd=directory, follow_symlinks=False)
        elif stat.S_ISDIR(info.st_mode):
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
            try:
                actual = os.fstat(child)
                if (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
                    raise RuntimeError('workspace directory changed')
                _chown_tree(child, uid, gid, device, budget, depth + 1)
            finally:
                os.close(child)
        elif stat.S_ISREG(info.st_mode):
            child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
            try:
                actual = os.fstat(child)
                if (actual.st_dev, actual.st_ino, actual.st_nlink) != (info.st_dev, info.st_ino, 1):
                    raise RuntimeError('workspace has a changed or multiply linked file')
                os.fchown(child, uid, gid)
            finally:
                os.close(child)
        else:
            raise RuntimeError('workspace contains a special file')
    os.fchown(directory, uid, gid)


class Task:
    def __init__(self, config, ticket, mode, user):
        self.ticket = ticket
        self.mode = mode
        self.user = user
        self.account = pwd.getpwnam(user)
        self.unit = task_unit(ticket, config['instance'])
        self.lifecycle = threading.RLock()
        self._write = threading.Lock()
        self._pending_lock = threading.Lock()
        self._pending = {}
        self._ready = threading.Event()
        self._failure = None
        self.invocation = None
        self.process = subprocess.Popen(unit_arguments(config, ticket, mode, user), stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        threading.Thread(target=self._read, daemon=True).start()
        if not self._ready.wait(20) or self._failure:
            self.stop()
            raise RuntimeError('isolated worker did not become ready')
        try:
            self.pid, self.invocation = _verify_process(self.unit, config['rootfs'], self.account, mode)
        except BaseException:
            self.stop()
            raise

    def _read(self):
        try:
            while True:
                line = self.process.stdout.readline(_MAX_RESPONSE + 1)
                if not line:
                    break
                if len(line) > _MAX_RESPONSE or not line.endswith(b'\n'):
                    raise RuntimeError('isolated worker response exceeded its limit')
                if not line.startswith(_PREFIX):
                    continue
                message = json.loads(line[len(_PREFIX):])
                if message.get('kind') == 'ready':
                    self._ready.set()
                    continue
                call_id = message.get('id')
                with self._pending_lock:
                    pending = self._pending.get(call_id)
                    if pending:
                        pending['value'] = message
                        pending['event'].set()
        except Exception:
            pass
        finally:
            self._failure = 'isolated worker exited'
            self._ready.set()
            with self._pending_lock:
                for pending in self._pending.values():
                    pending['event'].set()

    def _send(self, message, cancelled=None, deadline_ms=None):
        encoded = json.dumps(message, ensure_ascii=False, separators=(',', ':')).encode() + b'\n'
        if len(encoded) > 24 * 1024 * 1024:
            raise ValueError('worker request exceeds its limit')
        with self._write:
            if cancelled is not None and cancelled.is_set():
                raise RuntimeError('isolated tool call was cancelled')
            if deadline_ms is not None and time.monotonic_ns() // 1_000_000 > deadline_ms:
                raise RuntimeError('isolated tool call expired before dispatch')
            if self.process.poll() is not None or self._failure:
                raise RuntimeError('isolated worker is unavailable')
            self.process.stdin.write(encoded)
            self.process.stdin.flush()

    def call(self, call_id, name, arguments, timeout=660, cancelled=None, deadline_ms=None):
        if not isinstance(call_id, str) or re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', call_id) is None:
            raise ValueError('invalid call id')
        if name not in _TOOLS or not isinstance(arguments, dict):
            raise ValueError('unsupported worker tool')
        pending = {'event': threading.Event()}
        with self._pending_lock:
            if call_id in self._pending:
                raise ValueError('duplicate call id')
            self._pending[call_id] = pending
        try:
            self._send({'kind': 'call', 'id': call_id, 'name': name, 'arguments': arguments}, cancelled, deadline_ms)
            if not pending['event'].wait(timeout):
                self.abort(call_id)
                if not pending['event'].wait(10):
                    self.stop()
                raise TimeoutError('isolated tool call timed out')
            response = pending.get('value')
            if not response or response.get('kind') != 'result':
                raise RuntimeError('isolated tool call failed')
            return response
        finally:
            with self._pending_lock:
                self._pending.pop(call_id, None)

    def abort(self, call_id):
        if not isinstance(call_id, str) or re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', call_id) is None:
            raise ValueError('invalid call id')
        self._send({'kind': 'abort', 'id': call_id})

    def frozen(self, operation):
        with self.lifecycle:
            current = _systemctl('show', self.unit, '-p', 'InvocationID', '--value', check=False)
            if self.invocation is None or current != self.invocation:
                raise RuntimeError('task invocation changed')
            try:
                _systemctl('freeze', self.unit)
                if _systemctl('show', self.unit, '-p', 'FreezerState', '--value') != 'frozen':
                    raise RuntimeError('task cgroup did not freeze')
                return operation()
            finally:
                _systemctl('thaw', self.unit)

    def stop(self):
        with self.lifecycle:
            current = _systemctl('show', self.unit, '-p', 'InvocationID', '--value', check=False)
            if self.invocation and current != self.invocation:
                if self.process.poll() is None:
                    self.process.terminate()
                    self.process.wait(timeout=5)
                return
            _systemctl('stop', self.unit, check=False)
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
                raise RuntimeError('systemd task did not stop')
            pid = _systemctl('show', self.unit, '-p', 'MainPID', '--value', check=False)
            if pid and pid != '0':
                raise RuntimeError('systemd task still has a main process')
            cgroup = _systemctl('show', self.unit, '-p', 'ControlGroup', '--value', check=False)
            if cgroup:
                path = os.path.join('/sys/fs/cgroup', cgroup.lstrip('/'), 'cgroup.procs')
                try:
                    with open(path, encoding='ascii') as file:
                        if file.read().strip():
                            raise RuntimeError('systemd task still has live processes')
                except FileNotFoundError:
                    pass


class Broker:
    def __init__(self, config, slots, task_factory=Task, recover=True):
        self.config = dict(config)
        task_unit('0' * 32, self.config['instance'])
        self.slots = tuple(slots)
        self.factory = task_factory
        self.lock = threading.RLock()
        self.closed = False
        self.generation = uuid.uuid4().hex
        self.tasks = {}
        self.calls = {}
        self.cancelled = {}
        self.epochs = {}
        self._accounts = {user: pwd.getpwnam(user) for user in self.slots}
        if not self.slots or len(self._accounts) != len(self.slots):
            raise ValueError('slot users must be non-empty and distinct')
        uids = [account.pw_uid for account in self._accounts.values()]
        if 0 in uids or len(set(uids)) != len(uids):
            raise ValueError('slot identities must be distinct and non-root')
        trusted_uid = config.get('trusted_uid')
        if type(trusted_uid) is not int or trusted_uid <= 0 or trusted_uid in uids:
            raise ValueError('slot identities must differ from the DSH service user')
        trusted_gid = pwd.getpwuid(trusted_uid).pw_gid
        for user, account in self._accounts.items():
            if account.pw_gid == trusted_gid or set(os.getgrouplist(user, account.pw_gid)) != {account.pw_gid}:
                raise ValueError('slot users cannot have supplementary groups')
        self.root = os.open(config['work_root'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        info = os.fstat(self.root)
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
            os.close(self.root)
            raise ValueError('work root must be owned by root with mode 0700')
        try:
            fcntl.flock(self.root, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if recover:
                self._recover()
        except BaseException:
            os.close(self.root)
            raise

    def _recover(self):
        prefix = 'dsh-sa-' + self.config['instance'] + '-task-'
        listing = _systemctl('list-units', '--all', '--plain', '--no-legend', prefix + '*.service')
        for line in listing.splitlines():
            name = line.split()[0] if line.split() else ''
            if re.fullmatch(re.escape(prefix) + r'[a-f0-9]{32}\.service', name):
                _systemctl('stop', name)
                pid = _systemctl('show', name, '-p', 'MainPID', '--value', check=False)
                if pid and pid != '0':
                    raise RuntimeError('an orphaned isolated task could not be stopped')

    def _directory(self, ticket, account=None, name='work'):
        task_unit(ticket, self.config['instance'])
        if account:
            try:
                os.mkdir(ticket, 0o700, dir_fd=self.root)
            except FileExistsError:
                pass
        task = os.open(ticket, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=self.root)
        try:
            info = os.fstat(task)
            if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
                raise RuntimeError('task directory has unsafe ownership')
            if account:
                try:
                    os.mkdir(name, 0o700, dir_fd=task)
                except FileExistsError:
                    pass
            work = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=task)
        finally:
            os.close(task)
        if account:
            try:
                _chown_tree(work, account.pw_uid, account.pw_gid, os.fstat(work).st_dev)
            except BaseException:
                os.close(work)
                raise
        return work

    def start(self, ticket, mode, epoch):
        task_unit(ticket, self.config['instance'])
        if mode not in ('read-only', 'workspace-write'):
            raise ValueError('invalid sandbox mode')
        if type(epoch) is not int or not 1 <= epoch <= 1_000_000_000:
            raise ValueError('invalid assignment epoch')
        with self.lock:
            if self.closed:
                raise RuntimeError('broker is stopping')
            current, revoked = self.epochs.get(ticket, (0, False))
            if epoch < current or epoch == current and revoked:
                raise RuntimeError('assignment is no longer authorized')
            if epoch > current:
                previous = self.tasks.get(ticket)
                if previous:
                    previous.stop()
                    del self.tasks[ticket]
                self.epochs[ticket] = (epoch, False)
            existing = self.tasks.get(ticket)
            if existing and existing.mode == mode and existing.process.poll() is None and not existing._failure:
                return existing
            if existing:
                existing.stop()
                del self.tasks[ticket]
            used = {item.user for item in self.tasks.values()}
            user = next((candidate for candidate in self.slots if candidate not in used), None)
            if user is None:
                raise RuntimeError('no isolated execution slot is available')
            for name in ('work', 'materials'):
                os.close(self._directory(ticket, self._accounts[user], name))
            task = self.factory(self.config, ticket, mode, user)
            self.tasks[ticket] = task
            return task

    def call(self, ticket, mode, epoch, call_id, name, arguments, deadline_ms=None):
        if not isinstance(call_id, str) or re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', call_id) is None:
            raise ValueError('invalid call id')
        if name not in _TOOLS or not isinstance(arguments, dict):
            raise ValueError('unsupported worker tool')
        if deadline_ms is not None:
            now = time.monotonic_ns() // 1_000_000
            if type(deadline_ms) is not int or not now <= deadline_ms <= now + 120_000:
                raise ValueError('invalid tool admission deadline')
        task_unit(ticket, self.config['instance'])
        key = (ticket, call_id)
        cancelled = threading.Event()
        with self.lock:
            self._prune_cancelled()
            if self.closed or key in self.cancelled:
                raise RuntimeError('isolated tool call was cancelled')
            if key in self.calls:
                raise ValueError('duplicate call id')
            self.calls[key] = cancelled
        try:
            task = self.start(ticket, mode, epoch)
            return task.call(call_id, name, arguments, cancelled=cancelled, deadline_ms=deadline_ms)
        finally:
            with self.lock:
                self.calls.pop(key, None)

    def _prune_cancelled(self):
        now = time.monotonic()
        self.cancelled = {key: until for key, until in self.cancelled.items() if until > now}

    def abort(self, ticket, call_id):
        task_unit(ticket, self.config['instance'])
        if not isinstance(call_id, str) or re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', call_id) is None:
            raise ValueError('invalid call id')
        with self.lock:
            if self.closed:
                return
            self._prune_cancelled()
            key = (ticket, call_id)
            if len(self.cancelled) >= 4096 and key not in self.cancelled:
                raise RuntimeError('too many pending cancellations')
            self.cancelled[key] = time.monotonic() + 900
            if key in self.calls:
                self.calls[key].set()
            task = self.tasks.get(ticket)
            if task:
                task.abort(call_id)

    def stage(self, ticket, mode, epoch, token, extension, data):
        with self.lock:
            task = self.start(ticket, mode, epoch)
            def copy():
                fd = self._directory(ticket, name='materials')
                try:
                    return stage_input(fd, token, extension, data, task.account.pw_uid, task.account.pw_gid, reuse=True)
                finally:
                    os.close(fd)
            return task.frozen(copy)

    def output(self, ticket, path):
        task_unit(ticket, self.config['instance'])
        with self.lock:
            if self.closed:
                raise RuntimeError('broker is stopping')
            task = self.tasks.get(ticket)
            def read():
                fd = self._directory(ticket)
                try:
                    return read_output(fd, path)
                finally:
                    os.close(fd)
            return task.frozen(read) if task else read()

    def jobs(self, ticket, epoch):
        task_unit(ticket, self.config['instance'])
        with self.lock:
            task = self.tasks.get(ticket) if self.epochs.get(ticket) == (epoch, False) else None
        if not task:
            return []
        result = task.call(new_call_id(), 'job_list', {}, timeout=15).get('result', {})
        if result.get('isError') or not isinstance(result.get('value'), list):
            raise RuntimeError('isolated jobs could not be read')
        return result['value']

    def release(self, ticket, epoch):
        task_unit(ticket, self.config['instance'])
        with self.lock:
            task = self.tasks.get(ticket) if self.epochs.get(ticket) == (epoch, False) else None
            if task:
                task.stop()
                del self.tasks[ticket]

    def stop(self, ticket, epoch):
        task_unit(ticket, self.config['instance'])
        if type(epoch) is not int or not 1 <= epoch <= 1_000_000_000:
            raise ValueError('invalid assignment epoch')
        with self.lock:
            current, _revoked = self.epochs.get(ticket, (0, False))
            if epoch < current:
                return
            self.epochs[ticket] = (epoch, True)
            for (active_ticket, _call_id), cancelled in self.calls.items():
                if active_ticket == ticket:
                    cancelled.set()
            task = self.tasks.get(ticket)
            if task:
                task.stop()
                del self.tasks[ticket]

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            for task in list(self.tasks.values()):
                task.stop()
            self.tasks.clear()
            os.close(self.root)


def encode_output(output):
    return {**output, 'data': base64.b64encode(output['data']).decode('ascii')}


def new_call_id():
    return uuid.uuid4().hex
