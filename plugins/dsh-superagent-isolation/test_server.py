import base64
import socket
import struct
import unittest
from unittest.mock import patch

from server import authorized_peer, dispatch


class Peer:
    def __init__(self, pid, uid):
        self.pid, self.uid = pid, uid

    def getsockopt(self, *_):
        return struct.pack('3i', self.pid, self.uid, 1000)


class FakeBroker:
    generation = '1' * 32
    def stage(self, ticket, mode, epoch, token, extension, data):
        return {'ticket': ticket, 'mode': mode, 'token': token, 'extension': extension, 'data': data}


class SocketProtocolTest(unittest.TestCase):
    @unittest.skipUnless(hasattr(socket, 'SO_PEERCRED'), 'requires Linux peer credentials')
    def test_requires_the_uid_and_the_actual_dsh_main_process(self):
        config = {'trusted_uid': 1000, 'host_unit': 'dsh-web.service'}
        with patch('server._systemctl', return_value='1234'):
            self.assertTrue(authorized_peer(Peer(1234, 1000), config))
            self.assertFalse(authorized_peer(Peer(1235, 1000), config))
            self.assertFalse(authorized_peer(Peer(1234, 1001), config))
        with patch('server._systemctl', side_effect=OSError('unavailable')):
            self.assertFalse(authorized_peer(Peer(1234, 1000), config))

    def test_stage_accepts_only_canonical_bounded_bytes_and_exact_fields(self):
        request = {'op': 'stage', 'generation': '1' * 32, 'ticket': 'a' * 32, 'mode': 'read-only', 'epoch': 1, 'token': 'b' * 32,
                   'extension': '.pdf', 'data': base64.b64encode(b'example').decode()}
        self.assertEqual(dispatch(FakeBroker(), request)['data'], b'example')
        for malformed in ({**request, 'data': 'ZXhhbXBsZQ==!'}, {**request, 'unknown': True}, {**request, 'data': 'Zg'}):
            with self.subTest(malformed=malformed), self.assertRaises(ValueError):
                dispatch(FakeBroker(), malformed)

    def test_rejects_requests_from_a_previous_broker_generation(self):
        self.assertEqual(dispatch(FakeBroker(), {'op': 'status'}), {'generation': '1' * 32})
        with self.assertRaises(ValueError):
            dispatch(FakeBroker(), {'op': 'stop', 'generation': '2' * 32, 'ticket': 'a' * 32, 'epoch': 1})


if __name__ == '__main__':
    unittest.main()
