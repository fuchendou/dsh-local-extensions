import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import { hasManualModel, webPromptAdmission } from './web-controller.js';

export default class RoutedLocalAttachmentStore extends LocalAttachmentStore {
  async admitPromptContent(content) {
    const admitted = await super.admitPromptContent(content);
    const admission = webPromptAdmission.getStore();
    if (!admission) return admitted;
    admission.signal.throwIfAborted();
    const agent = this.ctx.get('agents')?.get(admission.sessionId);
    const router = this.ctx.get('personalModelRouter');
    if (agent && router) {
      try {
        if (hasManualModel(agent)) router.markManual(agent);
        await router.prepare(agent, { content: admitted, source: admission.source }, admission.signal);
      } catch (error) {
        if (!admission.signal.aborted) this.ctx.logger.warn('unable to prepare automatic model:', error?.message ?? error);
      }
    }
    admission.signal.throwIfAborted();
    return admitted;
  }
}
