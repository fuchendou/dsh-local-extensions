import { lookup } from 'node:dns/promises';
import { request as http } from 'node:http';
import { request as https } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { WebError } from '@deepseek-ai/dsh-web';

export const name = 'personalai-public-web';
export const inject = ['web'];

const nonPublic = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
]) nonPublic.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  nonPublic.addSubnet(address, prefix, 'ipv6');
}
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_BYTES = 2 * 1024 * 1024;

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !nonPublic.check(address, 'ipv4');
  return family === 6 && publicV6.check(address, 'ipv6') && !nonPublic.check(address, 'ipv6');
}

function fetchUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new WebError('Invalid fetch URL', 'WEB_FETCH_INVALID_URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new WebError('Use an HTTP(S) URL without embedded credentials', 'WEB_FETCH_INVALID_URL');
  }
  return url;
}

async function requestPublic(url, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  const records = literal ? [{ address: hostname, family: literal }] : await lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (!records.length || records.some(record => !isPublicAddress(record.address))) {
    throw new WebError('Fetch destination must resolve only to public addresses', 'WEB_FETCH_URL_BLOCKED');
  }
  const request = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const outgoing = request(url, {
      agent: false,
      signal,
      headers: { 'user-agent': 'DeepSeek-Harness Web Fetch', 'accept-encoding': 'identity' },
      lookup(_hostname, options, callback) {
        const choices = options.family ? records.filter(record => record.family === options.family) : records;
        if (!choices.length) return callback(new Error('No address for the requested network family'));
        if (options.all) return callback(null, choices);
        callback(null, choices[0].address, choices[0].family);
      },
    }, resolve);
    outgoing.on('error', reject);
    outgoing.end();
  });
}

export async function fetchPublic({ url: input }, parentSignal) {
  const deadline = AbortSignal.timeout(30_000);
  const signal = parentSignal ? AbortSignal.any([parentSignal, deadline]) : deadline;
  let url = fetchUrl(input);
  for (let hop = 0; hop <= 5; hop++) {
    const response = await requestPublic(url, signal);
    if (REDIRECTS.has(response.statusCode) && response.headers.location) {
      response.destroy();
      const next = fetchUrl(new URL(response.headers.location, url));
      if (hop === 5 || next.origin !== url.origin) {
        throw new WebError('Fetch requires a bounded, same-origin redirect', 'WEB_FETCH_REDIRECT_BLOCKED');
      }
      url = next;
      continue;
    }
    const type = String(response.headers['content-type'] ?? '');
    if (type && !/^(?:text\/|application\/(?:[\w.+-]*\+)?(?:json|xml)\b)/i.test(type)) {
      response.destroy();
      throw new WebError('Fetch supports text, HTML, JSON and XML', 'WEB_FETCH_UNSUPPORTED_CONTENT_TYPE');
    }
    const chunks = [];
    let size = 0;
    let truncated = false;
    for await (const chunk of response) {
      chunks.push(chunk.subarray(0, MAX_BYTES - size));
      size += chunk.length;
      if (size > MAX_BYTES) {
        truncated = true;
        break;
      }
    }
    const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1] ?? 'utf-8';
    let decoder;
    try { decoder = new TextDecoder(charset); } catch { decoder = new TextDecoder(); }
    const content = decoder.decode(Buffer.concat(chunks));
    const kind = /^(text\/html|application\/xhtml\+xml)\b/i.test(type) ? 'html' : 'text';
    return { url: url.href, statusCode: response.statusCode, body: { kind, content }, truncated };
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.web.registerFetchProvider({ id: 'public-http', available: () => true, fetch: fetchPublic }));
}
