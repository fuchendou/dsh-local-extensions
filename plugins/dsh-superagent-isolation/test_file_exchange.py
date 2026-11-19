import errno
import hashlib
import os
import platform
import pwd
import tempfile
import unittest
from pathlib import Path

from file_exchange import MAX_BYTES, read_output, stage_input


@unittest.skipUnless(platform.system() == 'Linux' and platform.machine() in ('x86_64', 'aarch64'), 'requires Linux openat2')
class FileExchangeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / 'work'
        self.root.mkdir()
        self.root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        account = pwd.getpwnam('nobody') if os.getuid() == 0 else None
        self.uid, self.gid = (account.pw_uid, account.pw_gid) if account else (os.getuid(), os.getgid())

    def tearDown(self):
        os.close(self.root_fd)
        self.temporary.cleanup()

    def test_reads_regular_office_file_and_hashes_exact_bytes(self):
        (self.root / 'nested').mkdir()
        data = '中文内容'.encode()
        (self.root / 'nested' / 'sample.DOCX').write_bytes(data)
        result = read_output(self.root_fd, 'nested/sample.DOCX')
        self.assertEqual(result['data'], data)
        self.assertEqual(result['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(result['size'], len(data))

    def test_rejects_absolute_parent_and_unapproved_formats(self):
        for path in ('/tmp/sample.pdf', '../sample.pdf', 'a/../sample.pdf', 'a//sample.pdf', 'sample.txt', 'x\\a.pdf'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                read_output(self.root_fd, path)

    def test_rejects_final_and_intermediate_symlinks(self):
        (self.root / 'target.pdf').write_bytes(b'content')
        (self.root / 'link.pdf').symlink_to(self.root / 'target.pdf')
        (self.root / 'dir').symlink_to(self.root, target_is_directory=True)
        for path in ('link.pdf', 'dir/target.pdf'):
            with self.subTest(path=path), self.assertRaises(OSError) as caught:
                read_output(self.root_fd, path)
            self.assertIn(caught.exception.errno, (errno.ELOOP, errno.EXDEV))

    def test_rejects_existing_hardlink_alias(self):
        secret = Path(self.temporary.name) / 'outside.pdf'
        secret.write_bytes(b'synthetic secret')
        os.link(secret, self.root / 'alias.pdf')
        with self.assertRaises(ValueError):
            read_output(self.root_fd, 'alias.pdf')

    def test_rejects_empty_oversized_directory_and_fifo(self):
        (self.root / 'empty.pdf').touch()
        with open(self.root / 'large.pdf', 'wb') as file:
            file.truncate(MAX_BYTES + 1)
        (self.root / 'dir.pdf').mkdir()
        os.mkfifo(self.root / 'pipe.pdf')
        for path in ('empty.pdf', 'large.pdf', 'dir.pdf', 'pipe.pdf'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                read_output(self.root_fd, path)

    def test_stages_a_new_inode_and_never_overwrites_an_existing_input(self):
        source = Path(self.temporary.name) / 'source.pdf'
        source.write_bytes(b'authorized bytes')
        alias = Path(self.temporary.name) / 'source-alias.pdf'
        os.link(source, alias)
        token = 'a' * 32
        result = stage_input(self.root_fd, token, '.pdf', source.read_bytes(), self.uid, self.gid)
        staged = self.root / result['path']
        self.assertNotEqual(source.stat().st_ino, staged.stat().st_ino)
        self.assertEqual(staged.stat().st_nlink, 1)
        self.assertEqual(staged.read_bytes(), b'authorized bytes')
        with self.assertRaises(FileExistsError):
            stage_input(self.root_fd, token, '.pdf', b'replacement', self.uid, self.gid)
        self.assertEqual(staged.read_bytes(), b'authorized bytes')

    def test_rejects_symlinked_input_directory(self):
        outside = Path(self.temporary.name) / 'outside'
        outside.mkdir()
        (self.root / 'inputs').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            stage_input(self.root_fd, 'b' * 32, '.pdf', b'content', self.uid, self.gid)
        self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_invalid_input_identity_and_name(self):
        for token, extension, uid in (('../bad', '.pdf', self.uid), ('a' * 32, '/../pdf', self.uid), ('a' * 32, '.pdf', 0)):
            with self.subTest(token=token, extension=extension, uid=uid), self.assertRaises(ValueError):
                stage_input(self.root_fd, token, extension, b'content', uid, self.gid)


if __name__ == '__main__':
    unittest.main()
