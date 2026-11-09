import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { apply } from '../src/index.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

describe('channel HTTP authentication', () => {
  let server: http.Server;
  let base: string;
  let calls = 0;
  let available = true;
  const connection = {
    admit(req: IncomingMessage) {
      if (req.headers.origin === 'https://other.example') return { rejection: 403 };
      if (req.headers.cookie === 'session=owner') return { peer: { principal: { kind: 'owner' } } };
      if (req.headers.cookie === 'session=guest') return { peer: { principal: { kind: 'guest' } } };
      return { rejection: 401 };
    },
  };

  beforeAll(async () => {
    const handlers = new Map<string, Handler>();
    const webServer = { register: (route: { path: string; handler: Handler }) => handlers.set(route.path, route.handler) };
    const channels = { list: () => { calls++; return []; }, get: () => undefined };
    const control = { listChannels: () => { calls++; return []; } };
    const ctx = {
      inject: (_deps: unknown, fn: (value: unknown) => void) => fn({ webServer, channels }),
      get: (name: string) => name === 'connection' ? (available ? connection : undefined) : name === 'channelControl' ? control : undefined,
    };
    apply(ctx as never);
    server = http.createServer((req, res) => {
      const handler = [...handlers].find(([path]) => (req.url ?? '').startsWith(path))?.[1];
      if (handler) void handler(req, res);
      else { res.writeHead(404); res.end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects unauthenticated reads and mutations in both API versions before dispatch', async () => {
    const before = calls;
    for (const [method, path] of [
      ['GET', '/dsh-channels/api/v1/channels'],
      ['POST', '/dsh-channels/api/v1/channels/weixin/auth/start'],
      ['GET', '/dsh-channels/api/v2/channels'],
      ['PUT', '/dsh-channels/api/v2/channels/weixin/enabled'],
      ['PATCH', '/dsh-channels/api/v2/channels/weixin/config'],
      ['DELETE', '/dsh-channels/api/v2/channels/weixin/auth/sessions/1'],
    ]) {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' } });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(calls).toBe(before);
  });

  it('uses the connection trust decision and requires an owner', async () => {
    for (const path of ['/dsh-channels/api/v1/channels', '/dsh-channels/api/v2/channels']) {
      expect((await fetch(base + path, { headers: { cookie: 'session=guest' } })).status).toBe(403);
      expect((await fetch(base + path, { headers: { cookie: 'session=owner', origin: 'https://other.example' } })).status).toBe(403);
      expect((await fetch(base + path, { headers: { cookie: 'session=owner' } })).status).toBe(200);
    }
  });

  it('fails closed when Connection is unavailable and recovers when it returns', async () => {
    available = false;
    try {
      for (const version of ['v1', 'v2']) {
        expect((await fetch(`${base}/dsh-channels/api/${version}/channels`, { headers: { cookie: 'session=owner' } })).status).toBe(503);
      }
    } finally {
      available = true;
    }
    expect((await fetch(`${base}/dsh-channels/api/v2/channels`, { headers: { cookie: 'session=owner' } })).status).toBe(200);
  });
});
