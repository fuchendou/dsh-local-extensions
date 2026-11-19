"""Socket-activated broker entry point. Not installed by this repository."""

import base64
import json
import os
import re
import signal
import socket
import socketserver
import stat
import struct
import sys
import threading

from broker import Broker, _systemctl, encode_output
from file_exchange import MAX_BYTES


MAX_REQUEST = 29 * 1024 * 1024


def load_config(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022 or info.st_size > 65536:
            raise ValueError('unsafe broker configuration')
        with os.fdopen(fd, 'r', encoding='utf-8', closefd=False) as file:
            config = json.load(file)
    finally:
        os.close(fd)
    required = {'rootfs', 'work_root', 'runtime', 'node', 'usr', 'office_venv', 'office_kit', 'instance', 'slots',
                'trusted_uid', 'host_unit', 'broker_unit', 'socket'}
    if not isinstance(config, dict) or set(config) != required:
        raise ValueError('invalid broker configuration keys')
    if not isinstance(config['trusted_uid'], int) or config['trusted_uid'] <= 0:
        raise ValueError('invalid trusted uid')
    if not isinstance(config['slots'], list) or not config['slots'] or not all(isinstance(x, str) for x in config['slots']):
        raise ValueError('invalid slot configuration')
    if not isinstance(config['host_unit'], str) or re.fullmatch(r'[a-zA-Z0-9_.-]+\.service', config['host_unit']) is None:
        raise ValueError('invalid DSH service unit')
    if not isinstance(config['socket'], str) or not config['socket'].startswith('/run/') or '\0' in config['socket']:
        raise ValueError('invalid broker socket path')
    return config


def authorized_peer(connection, config):
    pid, uid, _gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
    if uid != config['trusted_uid'] or pid <= 1:
        return False
    try:
        main_pid = int(_systemctl('show', config['host_unit'], '-p', 'MainPID', '--value'))
    except Exception:
        return False
    return main_pid == pid


def _keys(request, *keys):
    if not isinstance(request, dict) or set(request) != set(keys):
        raise ValueError('invalid request')


def dispatch(broker, request):
    op = request.get('op') if isinstance(request, dict) else None
    if op == 'status':
        _keys(request, 'op')
        return {'generation': broker.generation}
    if not isinstance(request, dict) or request.get('generation') != broker.generation:
        raise ValueError('broker generation changed')
    if op == 'call':
        _keys(request, 'op', 'generation', 'ticket', 'mode', 'epoch', 'call_id', 'name', 'arguments', 'deadline_ms')
        if type(request['deadline_ms']) is not int:
            raise ValueError('invalid tool admission deadline')
        return broker.call(request['ticket'], request['mode'], request['epoch'], request['call_id'], request['name'], request['arguments'], request['deadline_ms'])
    if op == 'abort':
        _keys(request, 'op', 'generation', 'ticket', 'call_id')
        broker.abort(request['ticket'], request['call_id'])
        return {'ok': True}
    if op == 'stop':
        _keys(request, 'op', 'generation', 'ticket', 'epoch')
        broker.stop(request['ticket'], request['epoch'])
        return {'ok': True}
    if op == 'release':
        _keys(request, 'op', 'generation', 'ticket', 'epoch')
        broker.release(request['ticket'], request['epoch'])
        return {'ok': True}
    if op == 'jobs':
        _keys(request, 'op', 'generation', 'ticket', 'epoch')
        return broker.jobs(request['ticket'], request['epoch'])
    if op == 'stage':
        _keys(request, 'op', 'generation', 'ticket', 'mode', 'epoch', 'token', 'extension', 'data')
        encoded = request['data']
        if not isinstance(encoded, str) or len(encoded) > ((MAX_BYTES + 2) // 3) * 4:
            raise ValueError('invalid staged input')
        data = base64.b64decode(encoded, validate=True)
        if base64.b64encode(data).decode('ascii') != encoded:
            raise ValueError('noncanonical staged input')
        return broker.stage(request['ticket'], request['mode'], request['epoch'], request['token'], request['extension'], data)
    if op == 'output':
        _keys(request, 'op', 'generation', 'ticket', 'path')
        return encode_output(broker.output(request['ticket'], request['path']))
    raise ValueError('unknown broker operation')


class RequestHandler(socketserver.BaseRequestHandler):
    def handle(self):
        if not authorized_peer(self.request, self.server.config):
            return
        self.request.settimeout(15)
        reader = self.request.makefile('rb')
        try:
            line = reader.readline(MAX_REQUEST + 1)
            if len(line) > MAX_REQUEST or not line.endswith(b'\n'):
                return
            request = json.loads(line)
            self.request.settimeout(None)
            try:
                result = {'ok': True, 'result': dispatch(self.server.broker, request)}
            except Exception:
                result = {'ok': False, 'error': 'isolated operation failed'}
            self.request.sendall(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode() + b'\n')
        except (OSError, ValueError, json.JSONDecodeError):
            return
        finally:
            reader.close()


class BrokerServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, activated_socket, broker, config):
        self.config = config
        self.broker = broker
        self.permits = threading.BoundedSemaphore(16)
        super().__init__(config['socket'], RequestHandler, bind_and_activate=False)
        self.socket.close()
        self.socket = activated_socket
        self.server_address = config['socket']

    def process_request(self, request, client_address):
        if not self.permits.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.permits.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.permits.release()


def main():
    if os.getuid() != 0 or len(sys.argv) != 2 or os.environ.get('LISTEN_PID') != str(os.getpid()) or os.environ.get('LISTEN_FDS') != '1':
        raise RuntimeError('broker requires root and one systemd-activated socket')
    config = load_config(sys.argv[1])
    activated = socket.socket(fileno=3)
    if activated.family != socket.AF_UNIX or activated.type != socket.SOCK_STREAM or activated.getsockname() != config['socket']:
        raise RuntimeError('unexpected activated socket')
    broker = Broker(config, config['slots'])
    server = BrokerServer(activated, broker, config)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    try:
        server.serve_forever()
    finally:
        broker.close()
        server.server_close()


if __name__ == '__main__':
    main()
