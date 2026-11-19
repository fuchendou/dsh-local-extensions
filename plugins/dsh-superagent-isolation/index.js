import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { basename, extname, isAbsolute } from 'node:path';
import { pngFromRgb } from './raster.js';

export const name = 'personal-isolation';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_WIRE_BYTES = 33 * 1024 * 1024;
const OFFICE = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);
const TEXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonc', '.xml', '.yaml', '.yml', '.log',
  '.py', '.sh', '.js', '.mjs', '.ts', '.html', '.css', '.sql', '.toml', '.ini']);
const IMAGES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const TIMEOUT = 700_000;

function transport(path, payload, timeout = 35_000) {
  return new Promise((resolve, reject) => {
    const request = Buffer.from(`${JSON.stringify(payload)}\n`);
    if (request.length > MAX_WIRE_BYTES) { reject(new Error('隔离请求超过大小上限。')); return; }
    const socket = createConnection({ path });
    const chunks = [];
    let size = 0;
    let finished = false;
    const settle = (error, value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const unavailable = () => settle(new Error('隔离任务服务不可用或未确认完成。'));
    socket.setTimeout(timeout, unavailable);
    socket.once('error', unavailable);
    socket.once('end', unavailable);
    socket.once('connect', () => { socket.write(request); });
    socket.on('data', chunk => {
      if ((size += chunk.length) > MAX_WIRE_BYTES) { unavailable(); return; }
      chunks.push(chunk);
      const end = chunk.indexOf(10);
      if (end < 0) return;
      if (end !== chunk.length - 1) { unavailable(); return; }
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (response?.ok !== true || !Object.hasOwn(response, 'result')) {
          settle(new Error('隔离任务服务拒绝或未能完成操作。'));
          return;
        }
        settle(undefined, response.result);
      } catch { unavailable(); }
    });
  });
}

function hex(value) { return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value); }

function part(response, path) {
  const { name, mimeType, data, size, sha256 } = response ?? {};
  if (name !== basename(path) || typeof mimeType !== 'string' || !OFFICE.has(extname(name).toLowerCase())
      || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || typeof data !== 'string'
      || data.length !== Math.ceil(size / 3) * 4) throw new Error('隔离文件交接格式无效。');
  const localData = Buffer.from(data, 'base64');
  if (localData.length !== size || localData.toString('base64') !== data
      || createHash('sha256').update(localData).digest('hex') !== sha256) throw new Error('隔离文件交接校验失败。');
  return { type: 'file', name, mimeType, localData };
}

function extension(asset, image) {
  const ext = extname(asset.name ?? '').toLowerCase();
  if (image) return IMAGES[asset.mimeType];
  if (OFFICE.has(ext)) return ext;
  if (TEXT.has(ext) || asset.mimeType?.startsWith('text/')) return '.txt';
  if (asset.mimeType === 'application/pdf') return '.pdf';
}

export function isolationClient(path, saveImage) {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('隔离代理需要绝对 socket 路径。');
  const request = (payload, timeout) => transport(path, payload, timeout);
  const generation = async () => {
    const status = await request({ op: 'status' });
    if (!hex(status?.generation)) throw new Error('隔离任务服务身份无法确认。');
    return status.generation;
  };
  const sessionRequest = async (op, details) => request({ op, generation: await generation(), ...details });
  const imageRef = async (response, signal) => {
    signal.throwIfAborted();
    const image = await saveImage({ data: pngFromRgb(response.image), mediaType: 'image/png' });
    signal.throwIfAborted();
    return image;
  };
  const call = async (task, name, args, signal) => {
    signal.throwIfAborted();
    const current = await generation();
    signal.throwIfAborted();
    const id = randomUUID().replaceAll('-', '');
    const identity = { generation: current, ticket: task.ticket, call_id: id };
    let cancellation;
    const abort = () => { cancellation ??= request({ op: 'abort', ...identity }).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await request({ op: 'call', ...identity, epoch: task.epoch, mode: task.mode, name,
        arguments: args, deadline_ms: Number(process.hrtime.bigint() / 1000000n) + 30_000 }, TIMEOUT);
      signal.throwIfAborted();
      if (typeof response?.result?.isError !== 'boolean') throw new Error('隔离工具响应格式无效。');
      if (!response.result.isError && name === 'read_image') {
        return { ...response.result, value: { path: response.result.value?.path, image: await imageRef(response, signal) } };
      }
      return response.result;
    } finally {
      signal.removeEventListener('abort', abort);
      await cancellation;
    }
  };
  const stage = async (task, asset, image, signal) => {
    signal.throwIfAborted();
    const ext = extension(asset, image);
    if (!ext || !(asset.data instanceof Uint8Array) || asset.data.length < 1 || asset.data.length > MAX_BYTES) {
      throw new Error('附件格式不受支持或超过隔离读取上限 20 MiB。');
    }
    const token = createHash('sha256').update(asset.data).digest('hex').slice(0, 32);
    const data = Buffer.from(asset.data).toString('base64');
    const result = await sessionRequest('stage', { ...task, token, extension: ext, data });
    signal.throwIfAborted();
    if (result?.path !== `inputs/${token}${ext}`) throw new Error('隔离附件路径无效。');
    return `/materials/${result.path}`;
  };
  return {
    ready: generation,
    call,
    async input(task, asset, offset, limit, signal) {
      const filePath = await stage(task, asset, false, signal);
      const result = await call(task, 'attachment_text', { file_path: filePath, offset, limit }, signal);
      if (result.isError) throw new Error('隔离进程无法解析此附件。');
      return { name: asset.name, ...result.value, file_path: filePath };
    },
    async image(task, asset, signal) {
      const filePath = await stage(task, asset, true, signal);
      const result = await call(task, 'read_image', { file_path: filePath }, signal);
      if (result.isError) throw new Error('隔离进程无法解析此图片。');
      return result.value.image;
    },
    async output(ticket, path) { return part(await sessionRequest('output', { ticket, path }), path); },
    stop: (ticket, epoch) => sessionRequest('stop', { ticket, epoch }),
    release: (ticket, epoch) => sessionRequest('release', { ticket, epoch }),
    jobs: (ticket, epoch) => sessionRequest('jobs', { ticket, epoch }),
  };
}

export function apply(ctx) {
  ctx.provide('personalIsolation', isolationClient(process.env.DSH_PERSONAL_ISOLATION_SOCKET ?? '/run/dsh-superagent-isolation.sock',
    input => {
      const attachments = ctx.get('attachments');
      if (!attachments) throw new Error('DSH 图片服务不可用。');
      return attachments.saveImage(input);
    }));
}
