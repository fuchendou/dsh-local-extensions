import { AsyncLocalStorage } from 'node:async_hooks';
import { SessionController } from '@deepseek-ai/dsh-api-session-controller';
import { appendPluginRecord, pluginRecordOf } from '@deepseek-ai/dsh-session';

export const webPromptAdmission = new AsyncLocalStorage();
const MODEL_POLICY_RECORD = 'plugin:personalai/model-policy';
const manualModels = new WeakMap();

export function hasManualModel(agent) {
  if (!manualModels.has(agent)) {
    const events = agent.session.snapshotEvents();
    const policy = events.findLast(event => pluginRecordOf(event)?.type === MODEL_POLICY_RECORD);
    const manual = policy ? policy.data.mode === 'manual' : events.some(event => event.type === 'model/selection');
    if (!policy && !manual) appendPluginRecord(agent.session, MODEL_POLICY_RECORD, { mode: 'auto' });
    manualModels.set(agent, manual);
  }
  return manualModels.get(agent);
}

export default class RoutedSessionController extends SessionController {
  pendingPrompts = new Map();
  promptReceipts = new Map();

  async prompt(request, signal) {
    signal.throwIfAborted();
    const key = JSON.stringify([request.sessionId, request.requestId]);
    const duplicate = this.promptReceipts.get(key);
    if (duplicate) return duplicate;
    const previous = this.pendingPrompts.get(request.sessionId);
    const source = { kind: 'user', rpcId: request.requestId };
    const run = async () => {
      signal.throwIfAborted();
      const admission = { sessionId: request.sessionId, source, signal };
      try {
        return await webPromptAdmission.run(admission, () => super.prompt(request, signal));
      } catch (error) {
        const agent = this.ctx.get('agents')?.get(request.sessionId);
        if (agent) this.ctx.get('personalModelRouter')?.discard(agent, { source });
        throw error;
      }
    };
    const task = previous ? previous.then(run, run) : run();
    this.pendingPrompts.set(request.sessionId, task);
    this.promptReceipts.set(key, task);
    try {
      const result = await task;
      const agent = this.ctx.get('agents')?.get(request.sessionId);
      if (agent) {
        const forget = () => this.promptReceipts.delete(key);
        void agent.whenIdle().then(forget, forget);
      } else {
        this.promptReceipts.delete(key);
      }
      return result;
    } catch (error) {
      this.promptReceipts.delete(key);
      throw error;
    } finally {
      if (this.pendingPrompts.get(request.sessionId) === task) this.pendingPrompts.delete(request.sessionId);
    }
  }

  async selectModel(request) {
    const result = await super.selectModel(request);
    const agent = this.ctx.get('agents')?.get(request.sessionId);
    if (agent) {
      this.ctx.get('personalModelRouter')?.markManual(agent);
      try {
        if (manualModels.get(agent) !== true) appendPluginRecord(agent.session, MODEL_POLICY_RECORD, { mode: 'manual' });
        manualModels.set(agent, true);
      } catch (error) {
        this.ctx.logger.warn('unable to save personal manual model policy:', error?.message ?? error);
      }
    }
    return result;
  }
}
