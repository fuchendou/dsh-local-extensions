import { realpathSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export function dshHome() {
  const configured = process.env.DSH_HOME;
  return resolve(configured?.replace(/^~(?=$|\/)/, homedir()) || join(homedir(), '.dsh'));
}

export function canonicalPath(path, cwd = process.cwd()) {
  if (typeof path !== 'string' || path.includes('\0')) throw new Error('无效路径');
  if (path.startsWith('file:')) path = fileURLToPath(path);
  path = path.replace(/^~(?=$|\/)/, homedir());
  const full = resolve(cwd, path);
  let parent = full;
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  return resolve(realpathSync(parent), relative(parent, full));
}

export function within(path, root) {
  const rest = relative(root, path);
  return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`));
}

export function configuredProtectedPaths(paths = []) {
  return paths.map(path => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('protectedPaths 必须使用绝对路径。');
    return path;
  });
}

export function protectedRoots(extra = [], protectedDataHomes = []) {
  const homes = [dshHome(), ...protectedDataHomes.map(home => {
    if (typeof home !== 'string' || !isAbsolute(home)) throw new Error('protectedDataHomes 必须使用绝对路径。');
    return home;
  })];
  const roots = homes.flatMap(home => ['sessions', 'storages', 'dsh-channels', 'todo-reminder'].map(name => join(home, name)));
  return [...new Set([...roots, ...extra].map(path => canonicalPath(path)))];
}

export function deniedPath(path, cwd, roots, recursive = false) {
  const base = path.split(/[?*\[\{]/, 1)[0] || '.';
  const canonical = canonicalPath(base, cwd);
  return roots.some(path => {
    const root = canonicalPath(path);
    return within(canonical, root) || (recursive && within(root, canonical));
  });
}

export function readableRoots(roots, filesystemRoot = '/') {
  const protectedPaths = roots.map(path => canonicalPath(path));
  const allowed = new Set();
  const visited = new Set();
  function visit(path) {
    let canonical;
    try { canonical = canonicalPath(path); } catch { return; }
    if (visited.has(canonical) || protectedPaths.some(root => within(canonical, root))) return;
    visited.add(canonical);
    if (!protectedPaths.some(root => within(root, canonical))) { allowed.add(canonical); return; }
    for (const entry of readdirSync(canonical, { withFileTypes: true })) visit(join(canonical, entry.name));
  }
  visit(filesystemRoot);
  return [...allowed];
}
