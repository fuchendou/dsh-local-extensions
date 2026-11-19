import os
import platform
import pwd
import tempfile
import unittest
from pathlib import Path

from broker import Broker


class FakeProcess:
    def __init__(self):
        self.alive = True

    def poll(self):
        return None if self.alive else 0


class FakeTask:
    def __init__(self, config, ticket, mode, user):
        self.ticket, self.mode, self.user = ticket, mode, user
        self.account = pwd.getpwnam(user)
        self.process = FakeProcess()
        self._failure = None
        self.freezes = 0

    def call(self, call_id, name, arguments, cancelled=None, deadline_ms=None):
        if cancelled and cancelled.is_set():
            raise RuntimeError('cancelled')
        return {'id': call_id, 'name': name, 'arguments': arguments}

    def frozen(self, operation):
        self.freezes += 1
        return operation()

    def stop(self):
        self.process.alive = False

    def abort(self, _call_id):
        pass


@unittest.skipUnless(platform.system() == 'Linux' and os.getuid() == 0, 'requires a root-owned Linux test directory')
class BrokerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / 'work-root'
        self.root.mkdir(mode=0o700)
        self.config = {'work_root': str(self.root), 'rootfs': '/opt/root', 'runtime': '/opt/runtime',
                       'node': '/opt/node', 'usr': '/usr', 'office_venv': '/opt/venv', 'office_kit': '/opt/office',
                       'instance': '1' * 12, 'trusted_uid': pwd.getpwnam('ubuntu').pw_uid}
        self.broker = Broker(self.config, ['nobody'], task_factory=FakeTask, recover=False)
        self.ticket = 'a' * 32

    def tearDown(self):
        self.broker.close()
        self.temporary.cleanup()

    def test_stage_and_output_use_a_frozen_task_and_separate_inode(self):
        result = self.broker.stage(self.ticket, 'workspace-write', 1, 'b' * 32, '.pdf', b'input')
        task = self.broker.tasks[self.ticket]
        self.assertEqual(task.freezes, 1)
        self.assertEqual((self.root / self.ticket / 'materials' / result['path']).read_bytes(), b'input')
        file = self.root / self.ticket / 'work' / 'output.pdf'
        file.write_bytes(b'output')
        self.assertEqual(self.broker.output(self.ticket, 'output.pdf')['data'], b'output')
        self.assertEqual(task.freezes, 2)

    def test_rejects_existing_hardlink_before_reassigning_a_slot(self):
        task = self.broker.start(self.ticket, 'workspace-write', 1)
        outside = Path(self.temporary.name) / 'outside.pdf'
        outside.write_bytes(b'synthetic secret')
        before = outside.stat().st_uid
        os.link(outside, self.root / self.ticket / 'work' / 'alias.pdf')
        self.broker.stop(self.ticket, 1)
        self.assertFalse(task.process.alive)
        with self.assertRaises(RuntimeError):
            self.broker.start(self.ticket, 'read-only', 2)
        self.assertEqual(outside.stat().st_uid, before)
        self.assertEqual(outside.read_bytes(), b'synthetic secret')

    def test_rejects_a_second_broker_and_ticket_path_injection(self):
        with self.assertRaises(BlockingIOError):
            Broker(self.config, ['nobody'], task_factory=FakeTask, recover=False)
        with self.assertRaises(ValueError):
            self.broker.start('../outside', 'workspace-write', 1)

    def test_one_slot_cannot_run_two_tickets(self):
        self.broker.start(self.ticket, 'workspace-write', 1)
        with self.assertRaises(RuntimeError):
            self.broker.start('c' * 32, 'workspace-write', 1)

    def test_cancellation_arriving_before_the_call_does_not_start_a_task(self):
        self.broker.abort(self.ticket, 'cancel-me')
        with self.assertRaises(RuntimeError):
            self.broker.call(self.ticket, 'workspace-write', 1, 'cancel-me', 'bash', {'command': 'true'})
        self.assertEqual(self.broker.tasks, {})

    def test_stopped_assignment_cannot_restart_and_stale_stop_cannot_kill_new_assignment(self):
        self.broker.stop(self.ticket, 1)
        with self.assertRaises(RuntimeError):
            self.broker.start(self.ticket, 'workspace-write', 1)
        task = self.broker.start(self.ticket, 'workspace-write', 2)
        self.broker.stop(self.ticket, 1)
        self.assertTrue(task.process.alive)


if __name__ == '__main__':
    unittest.main()
