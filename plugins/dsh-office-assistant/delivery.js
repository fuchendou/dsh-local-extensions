import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_BYTES = 20 * 1024 * 1024;
const MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
};

function within(path, root) {
  const rest = relative(root, path);
  return rest !== '' && !isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`);
}

async function readWorkspaceFile(guard, cwd, path) {
  const root = await realpath(cwd);
  const file = await realpath(resolve(root, path));
  if (!within(file, root) || !MIME[extname(file).toLowerCase()]) throw new Error('仅支持工作目录内的 Office 或 PDF 文件。');
  guard.assertReadable(file, root);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const actual = await realpath(process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : file);
    const mimeType = MIME[extname(actual).toLowerCase()];
    if (!within(actual, root) || !mimeType) throw new Error('文件已移出工作目录或格式不受支持。');
    guard.assertReadable(actual, root);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > MAX_BYTES) throw new Error('文件不可安全发送或超过 20 MiB。');
    const data = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await handle.read(data, length, data.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error('文件正在变化，请重试。');
    return { type: 'file', name: basename(actual), mimeType, localData: data.subarray(0, length) };
  } finally { await handle.close(); }
}

export async function deliverPresentedFiles(guard, session, files, deliver) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 8) return;
  for (const file of files) {
    try {
      if (typeof file?.path !== 'string' || !session.header?.cwd) throw new Error('文件路径不可用。');
      const part = await readWorkspaceFile(guard, session.header.cwd, file.path);
      await deliver({ parts: [part] });
    } catch {
      try { await deliver({ text: '有文件未能发送。请确认文件位于工作目录、格式受支持且不超过 20 MiB，然后重试。' }); } catch {}
    }
  }
}
