import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalPath, configuredProtectedPaths, deniedPath, protectedRoots, readableRoots, within } from './paths.js';
import { apply } from './index.js';

const home = canonicalPath(await mkdtemp(join(tmpdir(), 'history-guard-')));
const privateRoot = join(home, 'sessions');
const shared = join(home, 'workspaces');
await mkdir(privateRoot); await mkdir(shared);
await writeFile(join(privateRoot, 'old.jsonl'), 'private history');
await writeFile(join(shared, 'report.txt'), 'shared report');
await symlink(privateRoot, join(shared, 'alias'));

test('canonical path policy covers traversal, symlinks and recursive parent scans', () => {
  assert.equal(deniedPath('../sessions/old.jsonl', shared, [privateRoot]), true);
  assert.equal(deniedPath('alias/old.jsonl', shared, [privateRoot]), true);
  assert.equal(deniedPath(home, shared, [privateRoot], true), true);
  assert.equal(deniedPath('report.txt', shared, [privateRoot]), false);
  assert.equal(canonicalPath('alias/not-created', shared), join(privateRoot, 'not-created'));
});
test('Landlock allow roots include shared files without granting protected ancestors or aliases', () => {
  const allowed = readableRoots([privateRoot], home);
  assert.ok(allowed.some(root => within(join(shared, 'report.txt'), root)));
  assert.ok(!allowed.some(root => within(privateRoot, root)));
});
test('tool guard denies direct file reads, unknown executors and full-access bypasses', async () => {
  let guard;
  let sandbox = { historyIsolation: true };
  let mode = 'workspace-write';
  apply({ on: (_name, listener) => { guard = listener; }, get: name => ({
    channelSessions: { index: { peek: () => ({ kind: 'chat' }) }, getProtectedPaths: () => [privateRoot] },
    sandbox, sandboxPolicy: { resolve: () => ({ mode }) },
  })[name] });
  const call = (name, args) => guard({ name, arguments: args, agent: { id: 'ch-test', session: { header: { cwd: shared } } } }, async () => ({ kind: 'allow' }));
  assert.equal((await call('read', { file_path: 'alias/old.jsonl' })).kind, 'deny');
  assert.equal((await call('glob', { pattern: `${home}/**/*` })).kind, 'deny');
  assert.equal((await call('read', { file_path: 'report.txt' })).kind, 'allow');
  assert.equal((await call('search_sessions', {})).kind, 'deny');
  assert.equal((await call('bash', { command: 'pwd', sandbox_permissions: 'danger-full-access' })).kind, 'deny');
  mode = 'danger-full-access';
  assert.equal((await call('bash', { command: 'pwd' })).kind, 'deny');
  mode = 'workspace-write'; sandbox = undefined;
  assert.equal((await call('run_code', {})).kind, 'deny');
});

test('shared delivery guard follows the same configured protected roots', () => {
  let service;
  apply({ provide: (_name, value) => { service = value; }, on() {}, get: name => name === 'channelSessions' ? {
    getProtectedPaths: () => [privateRoot],
  } : undefined });
  assert.throws(() => service.assertReadable(join(shared, 'alias/old.jsonl'), shared), /受保护/);
  assert.doesNotThrow(() => service.assertReadable(join(shared, 'report.txt'), shared));
});

test('delegated agent IDs inherit the channel history boundary', async () => {
  let guard;
  apply({ on: (_event, listener) => { guard = listener; }, get: name => name === 'channelSessions' ? {
    getSessionEntry: id => id === 'delegated-id' ? { kind: 'goal' } : undefined,
    index: { peek: () => undefined }, getProtectedPaths: () => [privateRoot],
  } : undefined });
  const result = await guard({ name: 'read', arguments: { path: join(privateRoot, 'old.jsonl') },
    agent: { id: 'delegated-id', session: { header: { cwd: shared } } } }, async () => ({ kind: 'allow' }));
  assert.equal(result.kind, 'deny');
});

test('configured data homes protect both old and new archives, including aliases', async () => {
  const oldHome = join(home, 'old-home');
  const newHome = join(home, 'new-home');
  for (const location of [oldHome, newHome]) {
    await mkdir(join(location, 'sessions'), { recursive: true });
    await mkdir(join(location, 'storages'));
    await mkdir(join(location, 'dsh-channels'));
  }
  const alias = join(shared, 'new-home-alias');
  await symlink(newHome, alias);
  const roots = protectedRoots([], [oldHome, newHome]);
  assert.equal(deniedPath(join(oldHome, 'sessions', 'history'), shared, roots), true);
  assert.equal(deniedPath(join(alias, 'storages', 'index'), shared, roots), true);
  assert.equal(deniedPath(join(newHome, 'dsh-channels', 'backup'), shared, roots), true);
  assert.equal(deniedPath(join(newHome, 'todo-reminder', 'owners', 'other.json'), shared, roots), true);
  assert.equal(deniedPath(join(shared, 'report.txt'), shared, roots), false);
  assert.throws(() => protectedRoots([], ['relative-home']), /绝对路径/);
});

test('explicit protected paths cover private migration copies and reject relative paths', () => {
  const privateCopy = join(home, 'migration-private');
  const roots = protectedRoots(configuredProtectedPaths([privateCopy]));
  assert.equal(deniedPath(join(privateCopy, 'credentials.yaml'), shared, roots), true);
  assert.throws(() => configuredProtectedPaths(['relative-path']), /绝对路径/);
});
