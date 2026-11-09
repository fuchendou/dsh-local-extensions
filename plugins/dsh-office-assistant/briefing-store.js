import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const STATES = ['queued', 'generating', 'ready', 'sending', 'sent', 'failed', 'cancelled', 'expired'];

function validate(doc) {
  if (doc?.version !== 1 || !Array.isArray(doc.subscriptions) || !Array.isArray(doc.runs)) throw new Error('简报数据损坏，已停止读取。');
  const owners = new Set();
  for (const sub of doc.subscriptions) {
    if (!/^[a-f0-9]{64}$/.test(sub.owner?.key) || typeof sub.owner.sessionId !== 'string' || !sub.owner.sessionId
      || typeof sub.sessionId !== 'string' || typeof sub.enabled !== 'boolean' || !Number.isFinite(sub.createdAt)
      || !Array.isArray(sub.topics) || !sub.topics.length || sub.topics.length > 3
      || sub.topics.some(topic => typeof topic !== 'string' || !topic.trim() || topic.length > 80)
      || owners.has(sub.owner.key)) throw new Error('简报订阅数据无效。');
    owners.add(sub.owner.key);
  }
  const ids = new Set();
  for (const run of doc.runs) {
    if (typeof run.id !== 'string' || ids.has(run.id) || !owners.has(run.ownerKey) || !STATES.includes(run.status)
      || !Number.isFinite(run.deliverAt) || !Number.isFinite(run.nextWakeAt) || !Number.isFinite(run.nextDeliveryAt)
      || !/^\d{4}-\d{2}-\d{2}$/.test(run.date) || typeof run.sessionId !== 'string'
      || !['attempts', 'wakeAttempts', 'deliveryAttempts', 'nextPart'].every(key => Number.isInteger(run[key]) && run[key] >= 0)
      || !Array.isArray(run.compensationIds) || run.compensationIds.some(id => typeof id !== 'string')
      || (run.text !== undefined && typeof run.text !== 'string')) throw new Error('简报执行记录无效。');
    ids.add(run.id);
  }
  return doc;
}

export class BriefingStore {
  constructor(path) {
    this.path = path;
    try { this.doc = validate(JSON.parse(readFileSync(path, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.doc = { version: 1, subscriptions: [], runs: [] }; }
  }
  state() { return structuredClone(this.doc); }
  change(update) {
    const next = structuredClone(this.doc);
    update(next);
    validate(next);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next) + '\n', { mode: 0o600 });
    renameSync(temporary, this.path);
    this.doc = next;
  }
}
