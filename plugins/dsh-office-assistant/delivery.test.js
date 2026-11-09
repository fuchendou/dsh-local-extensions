import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deliverPresentedFiles } from './delivery.js';

test('channel delivery sends workspace Office files and rejects protected and escaped paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-channel-'));
  const workspace = join(root, 'workspace');
  const privateDir = join(workspace, 'private');
  await mkdir(workspace); await mkdir(privateDir);
  await writeFile(join(workspace, 'result.docx'), 'content');
  await writeFile(join(privateDir, 'secret.pdf'), 'secret');
  await writeFile(join(root, 'outside.pdf'), 'outside');
  await symlink(join(root, 'outside.pdf'), join(workspace, 'alias.pdf'));
  await link(join(privateDir, 'secret.pdf'), join(workspace, 'hardlink.pdf'));
  const sent = [];
  const protectedPath = await realpath(privateDir);
  const guard = { assertReadable(path) { if (path.startsWith(protectedPath)) throw new Error('protected'); } };
  const session = { header: { cwd: workspace } };
  await deliverPresentedFiles(guard, session, [{ path: 'result.docx' }, { path: 'private/secret.pdf' }, { path: 'alias.pdf' }, { path: 'hardlink.pdf' }], async message => sent.push(message));
  assert.equal(sent.length, 4);
  assert.equal(sent[0].parts[0].name, 'result.docx');
  assert.equal(sent[0].parts[0].localData.toString(), 'content');
  assert.match(sent[1].text, /未能发送/);
  assert.match(sent[2].text, /未能发送/);
  assert.match(sent[3].text, /未能发送/);
});

test('channel delivery reports unsupported files and send failures', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'office-channel-fail-'));
  await writeFile(join(workspace, 'result.pdf'), 'content');
  await writeFile(join(workspace, 'data.txt'), 'content');
  const notices = [];
  await deliverPresentedFiles({ assertReadable() {} }, { header: { cwd: workspace } },
    [{ path: 'result.pdf' }, { path: 'data.txt' }], async message => {
      if (message.parts) throw new Error('send failed');
      notices.push(message.text);
    });
  assert.equal(notices.length, 2);
  assert.ok(notices.every(text => text.includes('未能发送')));
});
