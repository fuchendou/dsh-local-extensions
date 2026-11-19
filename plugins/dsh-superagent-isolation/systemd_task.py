"""Construct the fixed systemd profile for one personal Super-agent task."""

import os
import pwd
import re
from pathlib import PurePosixPath


def _absolute(path):
    if not isinstance(path, str) or not path.startswith('/') or path != str(PurePosixPath(path)) or '..' in path.split('/'):
        raise ValueError('configured paths must be normalized absolute paths')
    if any(character.isspace() or character in ':\0' for character in path):
        raise ValueError('configured paths cannot contain whitespace, colon or NUL')
    return path


def task_unit(ticket, instance):
    if not isinstance(ticket, str) or re.fullmatch(r'[a-f0-9]{32}', ticket) is None:
        raise ValueError('invalid ticket id')
    if not isinstance(instance, str) or re.fullmatch(r'[a-f0-9]{12}', instance) is None:
        raise ValueError('invalid broker instance id')
    return 'dsh-sa-' + instance + '-task-' + ticket


def unit_arguments(config, ticket, mode, user):
    """Return argv only; task paths and systemd properties cannot come from the model."""
    unit = task_unit(ticket, config['instance'])
    if mode not in ('read-only', 'workspace-write'):
        raise ValueError('invalid sandbox mode')
    if not isinstance(user, str) or re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', user) is None:
        raise ValueError('invalid slot user')
    account = pwd.getpwnam(user)
    if account.pw_uid == 0 or account.pw_gid == 0:
        raise ValueError('slot identity cannot be root')
    rootfs = _absolute(config['rootfs'])
    work_root = _absolute(config['work_root'])
    runtime = _absolute(config['runtime'])
    node = _absolute(config['node'])
    usr = _absolute(config['usr'])
    office_venv = _absolute(config['office_venv'])
    office_kit = _absolute(config['office_kit'])
    work = os.path.join(work_root, ticket, 'work')
    materials = os.path.join(work_root, ticket, 'materials')
    work_bind = 'BindReadOnlyPaths' if mode == 'read-only' else 'BindPaths'
    properties = [
        'Type=exec', f'User={user}', f'Group={account.pw_gid}', f'RootDirectory={rootfs}',
        f'BindReadOnlyPaths={usr}:/usr', f'BindReadOnlyPaths={runtime}:/opt/runtime/app/node_modules',
        f'BindReadOnlyPaths={node}:/opt/runtime/node/bin/node', f'BindReadOnlyPaths={office_venv}:/opt/office/venv',
        f'BindReadOnlyPaths={office_kit}:/opt/office/kit', f'BindReadOnlyPaths={materials}:/materials', f'{work_bind}={work}:/work',
        'WorkingDirectory=/work', 'ProtectSystem=strict', 'MountAPIVFS=yes', 'PrivateNetwork=yes',
        'PrivateIPC=yes', 'PrivateDevices=yes', 'PrivateTmp=yes', 'TemporaryFileSystem=/run:ro',
        'ProtectProc=invisible', 'ProcSubset=pid', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes',
        'ProtectControlGroups=yes', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'RestrictNamespaces=yes',
        'RestrictSUIDSGID=yes', 'RestrictRealtime=yes', 'LockPersonality=yes', 'SystemCallArchitectures=native',
        'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6', 'KillMode=control-group', 'TasksMax=128', 'MemoryMax=2G',
        'TimeoutStopSec=8s', 'LimitFSIZE=256M',
        'Environment=DSH_ISOLATION_WORKER=1', 'Environment=DSH_ISOLATION_RUNTIME=/opt/runtime/app',
        'Environment=HOME=/tmp', 'Environment=PATH=/opt/runtime/node/bin:/usr/bin:/bin',
    ]
    for key in ('host_unit', 'broker_unit'):
        owner_unit = config.get(key)
        if owner_unit is not None:
            if not isinstance(owner_unit, str) or re.fullmatch(r'[a-zA-Z0-9_.-]+\.service', owner_unit) is None:
                raise ValueError('invalid service binding')
            properties.extend([f'BindsTo={owner_unit}', f'After={owner_unit}'])
    argv = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--unit=' + unit]
    for value in properties:
        argv.extend(['--property', value])
    argv.extend(['/opt/runtime/node/bin/node', '/opt/probe/tool_worker.mjs'])
    return argv
