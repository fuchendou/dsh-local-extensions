import unittest
from unittest.mock import patch

from systemd_task import task_unit, unit_arguments


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.config = {'rootfs': '/opt/dsh-isolation/root', 'work_root': '/var/lib/dsh-isolation/tasks',
                       'runtime': '/opt/dsh-isolation/runtime/node_modules', 'node': '/opt/dsh-isolation/runtime/node',
                       'usr': '/opt/dsh-isolation/runtime/usr', 'office_venv': '/opt/dsh-isolation/runtime/venv',
                       'office_kit': '/opt/dsh-isolation/runtime/office-kit', 'instance': '1' * 12}
        self.ticket = 'a' * 32
        self.account = type('Account', (), {'pw_uid': 30001, 'pw_gid': 30001})()
        self.user = patch('systemd_task.pwd.getpwnam', return_value=self.account)
        self.user.start()
        self.addCleanup(self.user.stop)

    def test_read_only_workspace_has_no_writable_alias_or_state_directory(self):
        args = unit_arguments(self.config, self.ticket, 'read-only', 'dshslot1')
        work = '/var/lib/dsh-isolation/tasks/' + self.ticket + '/work'
        self.assertIn('BindReadOnlyPaths=' + work + ':/work', args)
        self.assertFalse(any(value.startswith('BindPaths=') or value.startswith('StateDirectory=') for value in args))
        self.assertIn('TemporaryFileSystem=/run:ro', args)
        self.assertIn('NoNewPrivileges=yes', args)

    def test_workspace_write_has_one_fixed_workspace_bind(self):
        args = unit_arguments(self.config, self.ticket, 'workspace-write', 'dshslot1')
        writable = [value for value in args if value.startswith('BindPaths=')]
        self.assertEqual(writable, ['BindPaths=/var/lib/dsh-isolation/tasks/' + self.ticket + '/work:/work'])
        self.assertEqual(args[-2:], ['/opt/runtime/node/bin/node', '/opt/probe/tool_worker.mjs'])

    def test_rejects_model_controlled_unit_names_modes_and_root_identity(self):
        for ticket in ('../x', 'a' * 31, 'g' * 32, 'A' * 32):
            with self.subTest(ticket=ticket), self.assertRaises(ValueError):
                task_unit(ticket, '1' * 12)
        with self.assertRaises(ValueError):
            task_unit(self.ticket, '../not-an-instance')
        with self.assertRaises(ValueError):
            unit_arguments(self.config, self.ticket, 'danger-full-access', 'dshslot1')
        with self.assertRaises(ValueError):
            unit_arguments(self.config, self.ticket, 'read-only', 'root\nUnit=evil')
        self.account.pw_uid = 0
        with self.assertRaises(ValueError):
            unit_arguments(self.config, self.ticket, 'read-only', 'root')

    def test_rejects_ambiguous_systemd_bind_paths(self):
        for path in ('relative', '/opt/../other', '/opt/runtime:escape', '/opt/with space', '/opt/x\nOverride=yes'):
            config = {**self.config, 'runtime': path}
            with self.subTest(path=path), self.assertRaises(ValueError):
                unit_arguments(config, self.ticket, 'read-only', 'dshslot1')


if __name__ == '__main__':
    unittest.main()
