"""Bounded output reads from a stopped or frozen Linux task workspace."""

import ctypes
import errno
import hashlib
import os
import platform
import re
import stat
from pathlib import PurePosixPath


MAX_BYTES = 20 * 1024 * 1024
MIME = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pdf': 'application/pdf',
}

_RESOLVE_NO_XDEV = 0x01
_RESOLVE_NO_MAGICLINKS = 0x02
_RESOLVE_NO_SYMLINKS = 0x04
_RESOLVE_BENEATH = 0x08
_OPENAT2 = 437


class _OpenHow(ctypes.Structure):
    _fields_ = [('flags', ctypes.c_uint64), ('mode', ctypes.c_uint64), ('resolve', ctypes.c_uint64)]


def _relative_file(path):
    if not isinstance(path, str) or not path or '\0' in path or len(path.encode('utf-8')) > 1000:
        raise ValueError('invalid output path')
    parts = path.split('/')
    if path.startswith('/') or any(part in ('', '.', '..') for part in parts) or '\\' in path:
        raise ValueError('output path must be relative to the task workspace')
    mime = MIME.get(PurePosixPath(path).suffix.lower())
    if mime is None:
        raise ValueError('unsupported output format')
    return parts[-1], mime


def _open_beneath(root_fd, path, flags=None):
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'aarch64'):
        raise OSError(errno.ENOSYS, 'openat2 is unavailable on this platform')
    if flags is None:
        flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
    how = _OpenHow(flags, 0, _RESOLVE_NO_XDEV | _RESOLVE_NO_MAGICLINKS | _RESOLVE_NO_SYMLINKS | _RESOLVE_BENEATH)
    libc = ctypes.CDLL(None, use_errno=True)
    fd = libc.syscall(ctypes.c_long(_OPENAT2), ctypes.c_int(root_fd), ctypes.c_char_p(os.fsencode(path)),
                      ctypes.byref(how), ctypes.c_size_t(ctypes.sizeof(how)))
    if fd < 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))
    return fd


def stage_input(root_fd, token, extension, data, uid, gid, reuse=False):
    """Copy authorized bytes into a new inode before the task is started or thawed."""
    if not isinstance(token, str) or re.fullmatch(r'[a-f0-9]{32}', token) is None:
        raise ValueError('invalid input token')
    if extension not in ('.docx', '.xlsx', '.pptx', '.pdf', '.txt', '.md', '.png', '.jpg', '.jpeg', '.gif', '.webp'):
        raise ValueError('unsupported input extension')
    if not isinstance(data, bytes) or not 1 <= len(data) <= MAX_BYTES:
        raise ValueError('input must be non-empty and no larger than 20 MiB')
    if not isinstance(uid, int) or not isinstance(gid, int) or uid <= 0 or gid <= 0:
        raise ValueError('invalid task identity')
    try:
        os.mkdir('inputs', 0o700, dir_fd=root_fd)
    except FileExistsError:
        pass
    directory = _open_beneath(root_fd, 'inputs', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
    try:
        os.fchown(directory, uid, gid)
        os.fchmod(directory, 0o700)
        name = token + extension
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        except FileExistsError:
            if not reuse:
                raise
            fd = _open_beneath(directory, name)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != len(data):
                    raise ValueError('staged input identity changed')
                with os.fdopen(os.dup(fd), 'rb') as existing:
                    digest = hashlib.file_digest(existing, 'sha256').hexdigest()
                if digest != hashlib.sha256(data).hexdigest():
                    raise ValueError('staged input digest changed')
                return {'path': 'inputs/' + name, 'size': len(data), 'sha256': digest}
            finally:
                os.close(fd)
        try:
            os.fchown(fd, uid, gid)
            remaining = memoryview(data)
            while remaining:
                count = os.write(fd, remaining)
                if count <= 0:
                    raise OSError(errno.EIO, 'input copy made no progress')
                remaining = remaining[count:]
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != len(data):
                raise ValueError('staged input is not a singly linked regular file')
        finally:
            os.close(fd)
    finally:
        os.close(directory)
    return {'path': 'inputs/' + name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def read_output(root_fd, path):
    """Read one output. The caller must stop or freeze its entire task cgroup first.

    `root_fd` must be a broker-owned descriptor for the task workspace. The
    caller is responsible for authorizing the task and keeping that descriptor
    bound to the intended workspace throughout this operation.
    """
    name, mime = _relative_file(path)
    fd = _open_beneath(root_fd, path)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 1 <= before.st_size <= MAX_BYTES:
            raise ValueError('output is not a bounded, singly linked regular file')
        chunks = []
        remaining = before.st_size + 1
        while remaining:
            chunk = os.read(fd, min(remaining, 1024 * 1024))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b''.join(chunks)
        after = os.fstat(fd)
        identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
                                 info.st_mtime_ns, info.st_ctime_ns)
        if len(data) != before.st_size or identity(before) != identity(after):
            raise ValueError('output changed while being read')
        return {'name': name, 'mimeType': mime, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'data': data}
    finally:
        os.close(fd)
