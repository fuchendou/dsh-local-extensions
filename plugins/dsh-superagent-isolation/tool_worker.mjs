import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ALLOWED = new Set(['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill']);
const MAX_MESSAGE = 24 * 1024 * 1024;
const OFFICE_PYTHON = '/opt/office/venv/bin/python';
const OFFICE_CLI = '/opt/office/kit/python/office_cli.py';
const run = promisify(execFile);

export async function createToolRuntime(runtime, cwd) {
  const require = createRequire(resolve(runtime, 'package.json'));
  const load = async name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href);
  const modules = await Promise.all(['cordis', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-session', 'dsh-fs-local',
    'dsh-session-projection', 'dsh-working-directory', 'dsh-fs-observation-policy', 'dsh-tool-fs', 'dsh-tool-fs-search',
    'dsh-jobs-local', 'dsh-tool-jobs', 'dsh-subprocess-local', 'dsh-shell-env', 'dsh-bash-local', 'dsh-tool-bash',
    'dsh-attachment-local', 'dsh-tool-executor-native'].map(load));
  const [cordis, prompt, tools, agent, session, fs, projection, workingDirectory, fsPolicy, fsTool, search, jobs, jobTools,
    subprocess, shellEnv, bash, bashTool, attachments, nativeExecutor] = modules;
  const ctx = new cordis.Context();
  for (const [plugin, config] of [
    [prompt.default, {}], [tools.default, {}], [nativeExecutor, {}], [agent.default, {}], [fs.default, { cwd }],
    [projection.default, {}], [workingDirectory.default, { defaultDirectory: cwd }], [fsPolicy, {}],
    [attachments.default, { dshHome: resolve(process.env.TMPDIR ?? '/tmp', 'dsh-isolation-worker') }], [fsTool, {}],
    [subprocess.default, {}], [search, { sampleOverCapGlobResults: false }], [jobs.default, {}], [jobTools, {}],
    [shellEnv, {}], [bash.LocalBashExecutor, {}], [bashTool, {}],
  ]) await ctx.plugin(plugin, config);
  ctx.shellEnv.register({
    name: 'isolated-office',
    variables: {
      DSH_LIBREOFFICE_KIT_CLI: { description: 'Isolated Office renderer' },
      DSH_NODE: { description: 'Isolated Office renderer runtime' },
    },
    resolve: () => ({ DSH_LIBREOFFICE_KIT_CLI: '/opt/runtime/app/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js',
      DSH_NODE: '/opt/runtime/node/bin/node' }),
  });
  ctx.reflect.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['image'] }) });
  const types = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session/types')).href);
  const id = session.SessionId('isolated-worker');
  const scope = ctx.plugin(() => {});
  await scope;
  const worker = {
    id, ctx: scope.ctx, options: { provider: 'isolated', model: 'isolated' }, status: 'idle',
    session: session.Session.create(id, undefined, { version: types.SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false }),
    inject() {}, followup() {}, steer() {}, send() {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
  };
  await ctx.agents.register(worker);
  return { ctx, worker, sharp: require('sharp') };
}

export async function callTool(runtime, id, name, args, signal) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('invalid call id');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('invalid tool arguments');
  signal.throwIfAborted();
  if (name === 'attachment_text' || name === 'office_status') {
    if (process.env.DSH_ISOLATION_WORKER !== '1') throw new Error('isolated Office environment required');
    const argv = name === 'office_status' ? [OFFICE_CLI, 'status']
      : ['/opt/probe/attachment_reader.py', args.file_path, String(args.offset), String(args.limit)];
    const { stdout } = await run(OFFICE_PYTHON, argv, { signal, timeout: 60_000, maxBuffer: 256 * 1024,
      env: { ...process.env, DSH_NODE: '/opt/runtime/node/bin/node',
        DSH_LIBREOFFICE_KIT_CLI: '/opt/runtime/app/node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js' } });
    const value = JSON.parse(stdout);
    if (name === 'office_status') {
      return { isError: false, value: { ...value, python: { path: OFFICE_PYTHON, version: value.python?.version },
        cli: { path: OFFICE_CLI, exists: true }, skillsDir: '/opt/office/kit/assets/skills' } };
    }
    return { isError: false, value };
  }
  if (!ALLOWED.has(name)) throw new Error('tool is not available in the isolated worker');
  const batch = await runtime.ctx.tools.execute({
    calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }],
    signal,
    agent: runtime.worker,
  });
  const [result] = batch.results;
  if (result?.callId !== id) throw new Error('isolated tool result does not match its call');
  return result.result;
}

export async function imagePixels(runtime, result, signal) {
  const image = await runtime.ctx.attachments.readImage(result.value.image, signal);
  const raster = await runtime.sharp(image.data).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = raster.info;
  if (channels !== 3 || width < 1 || height < 1 || width * height > 4_194_304 || raster.data.length !== width * height * 3) {
    throw new Error('isolated image exceeds the pixel transfer limit');
  }
  return { width, height, rgb: raster.data.toString('base64') };
}

async function serve() {
  if (process.platform !== 'linux' || process.getuid?.() === 0 || process.cwd() !== '/work'
      || process.env.DSH_ISOLATION_WORKER !== '1' || !process.env.DSH_ISOLATION_RUNTIME) {
    throw new Error('isolated worker requires a non-root Linux task environment');
  }
  const protocol = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...args) => process.stderr.write(chunk, ...args);
  const send = value => protocol(`DSH-ISOLATION-1 ${JSON.stringify(value)}\n`);
  const ctx = await createToolRuntime(process.env.DSH_ISOLATION_RUNTIME, '/work');
  const pending = new Map();
  let queue = Promise.resolve();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  send({ kind: 'ready' });
  input.on('line', line => {
    let request;
    try {
      if (Buffer.byteLength(line) > MAX_MESSAGE) throw new Error('request is too large');
      request = JSON.parse(line);
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('invalid request');
    } catch {
      send({ kind: 'error', error: 'invalid request' });
      return;
    }
    if (request.kind === 'abort') {
      pending.get(request.id)?.abort();
      return;
    }
    if (request.kind !== 'call' || typeof request.id !== 'string' || pending.has(request.id)) {
      send({ kind: 'error', error: 'invalid request' });
      return;
    }
    const controller = new AbortController();
    pending.set(request.id, controller);
    queue = queue.then(async () => {
      try {
        const result = await callTool(ctx, request.id, request.name, request.arguments, controller.signal);
        const image = request.name === 'read_image' && !result.isError
          ? await imagePixels(ctx, result, controller.signal) : undefined;
        send({ kind: 'result', id: request.id, result, ...(image ? { image } : {}) });
      } catch (error) {
        send({ kind: 'error', id: request.id, error: error instanceof Error ? error.message : 'tool call failed' });
      } finally {
        pending.delete(request.id);
      }
    });
  });
  input.on('close', () => {
    for (const controller of pending.values()) controller.abort();
    void queue.finally(() => process.exit(0));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  serve().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'worker failed'}\n`); process.exitCode = 1; });
}
