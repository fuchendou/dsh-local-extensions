"""Build the sealed runtime and systemd templates from the validated DSH release."""

import argparse
import hashlib
import json
import os
import shutil
import stat
from pathlib import Path


SYSTEM_RUNTIME = ('bin', 'lib/x86_64-linux-gnu', 'lib/python3.12', 'lib/locale', 'lib64',
                  'share/fonts', 'share/fontconfig', 'share/zoneinfo', 'share/git-core')
BROKER_FILES = ('broker.py', 'server.py', 'systemd_task.py', 'file_exchange.py')
WORKER_FILES = ('tool_worker.mjs', 'attachment_reader.py')
HOST_FILES = ('index.js', 'raster.js', 'package.json')


def copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink():
        target.symlink_to(os.readlink(source))
    elif source.is_dir():
        shutil.copytree(source, target, symlinks=True)
    else:
        shutil.copy2(source, target)


def seal(base):
    hashes = {}
    for root, dirs, files in os.walk(base, followlinks=False):
        directory = Path(root)
        directory.chmod(0o755)
        for item in sorted(dirs + files):
            path = directory / item
            info = path.lstat()
            relative = str(path.relative_to(base))
            if path.is_symlink():
                hashes[relative] = {'link': os.readlink(path)}
            elif path.is_dir():
                continue
            elif stat.S_ISREG(info.st_mode):
                if item in ('.env', '.credentials.yaml', 'dsh.env'):
                    raise RuntimeError('runtime source contains a private configuration filename')
                path.chmod(0o755 if info.st_mode & 0o111 else 0o644)
                with path.open('rb') as file:
                    hashes[relative] = hashlib.file_digest(file, 'sha256').hexdigest()
            else:
                raise RuntimeError('runtime contains a special file')
    manifest = base / 'runtime-manifest.json'
    manifest.write_text(json.dumps(hashes, sort_keys=True) + '\n')
    print(json.dumps({'files': len(hashes), 'manifestSha256': hashlib.sha256(manifest.read_bytes()).hexdigest()}))


def snapshot(source, release, base):
    if os.getuid() != 0 or not base.is_absolute():
        raise RuntimeError('runtime snapshot requires an absolute root-owned destination')
    base.mkdir(parents=True, exist_ok=False, mode=0o755)
    rootfs = base / 'rootfs'
    for directory in ('proc', 'sys', 'dev', 'home', 'root', 'tmp', 'var/tmp', 'run', 'usr', 'work', 'materials',
                      'opt/probe', 'opt/office/kit', 'opt/office/venv', 'opt/runtime/app/node_modules', 'opt/runtime/node/bin', 'etc'):
        (rootfs / directory).mkdir(parents=True, exist_ok=True)
    for name in ('bin', 'lib', 'lib64'):
        (rootfs / name).symlink_to('usr/' + name)
    for name in SYSTEM_RUNTIME:
        path = Path('/usr') / name
        if path.exists():
            copy(path, base / 'runtime/usr' / name)
    for name, origin in {
        'node': release / 'runtime/node/bin/node',
        'node_modules': release / 'runtime/app/node_modules',
        'venv': release / 'home/office/runtime/venv',
        'office-kit': release / 'home/profiles/web/node_modules/dsh-office-kit',
    }.items():
        copy(origin.resolve(strict=True), base / 'runtime' / name)
    for name in WORKER_FILES:
        copy(source / name, rootfs / 'opt/probe' / name)
    for name in BROKER_FILES:
        copy(source / name, base / 'broker' / name)
    for name in HOST_FILES:
        copy(source / name, base / 'host' / name)
    (rootfs / 'opt/runtime/app/package.json').write_text('{"private":true,"type":"module"}\n')
    (rootfs / 'opt/runtime/node/bin/node').touch()
    for original, target in {
        release / 'runtime/node/bin/node': '/opt/runtime/node/bin/node',
        release / 'runtime/app/node_modules': '/opt/runtime/app/node_modules',
        release / 'home/office/runtime/venv': '/opt/office/venv',
        release / 'home/profiles/web/node_modules/dsh-office-kit': '/opt/office/kit',
    }.items():
        alias = rootfs / original.relative_to('/')
        alias.parent.mkdir(parents=True, exist_ok=True)
        alias.symlink_to(target)
    (rootfs / 'etc/nsswitch.conf').write_text('passwd: files\ngroup: files\nhosts: files\n')
    (rootfs / 'etc/hosts').write_text('127.0.0.1 localhost\n::1 localhost\n')
    try:
        (rootfs / 'etc/ld.so.conf').write_text('include /etc/ld.so.conf.d/*.conf\n')
    except OSError:
        raise RuntimeError('failed to create isolated library configuration')
    seal(base)


if __name__ == '__main__':
    arguments = argparse.ArgumentParser()
    arguments.add_argument('source', type=Path)
    arguments.add_argument('dsh_release', type=Path)
    arguments.add_argument('target', type=Path)
    args = arguments.parse_args()
    snapshot(args.source, args.dsh_release, args.target)
