import type { Context } from '@deepseek-ai/cordis';
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model';
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller';

export type ChannelModelSelectionMode = 'host' | 'local';

/**
 * Narrow channel view over the official Host session business API — only the
 * model surface this bridge consumes, derived from
 * `@deepseek-ai/dsh-api-session-controller` instead of a local duplicate.
 */
export type ChannelHostSessionController = Pick<SessionController, 'selectModel'>;

export class ChannelModelSelectionController {
  /**
   * The owner strategy is fixed when the Agent scope is installed. The Host
   * service itself is resolved live so HMR can replace its implementation
   * without changing ownership of an existing Agent.
   */
  private readonly strategies = new WeakMap<Context, ChannelModelSelectionMode>();

  constructor(private readonly rootCtx: Context) {}

  get mode(): ChannelModelSelectionMode {
    return this.hostSessionController() ? 'host' : 'local';
  }

  /** Install only the headless hook; Web Host owns it when sessionController is present. */
  install(agentCtx: Context): () => void {
    const strategy = this.mode;
    this.strategies.set(agentCtx, strategy);
    const dispose = strategy === 'local' ? installModelSelection(agentCtx) : undefined;
    return () => {
      dispose?.();
      if (this.strategies.get(agentCtx) === strategy) this.strategies.delete(agentCtx);
    };
  }

  async current(agent: Agent): Promise<ModelSelection | undefined> {
    const policy = await this.rootCtx.get('channelSessions')?.getModelPolicy(String(agent.id));
    if (policy?.mode === 'manual') {
      const { reasoningEffort, ...selection } = policy.selection;
      return { ...selection, ...(reasoningEffort ? { reasoningEffort: ReasoningEffortId(reasoningEffort) } : {}) };
    }
    return agent.model.current() ?? this.rootCtx.get('agentDefaultModel')?.currentSelection();
  }

  async selectionForStep(agent: Agent): Promise<ModelSelection | undefined> {
    return this.current(agent);
  }

  async select(agent: Agent, selection: ModelSelection): Promise<void> {
    if (this.strategyFor(agent) === 'host') {
      const controller = this.hostSessionController();
      if (!controller) {
        throw new Error('host model selection is unavailable: sessionController is not mounted');
      }
      try {
        await controller.selectModel({
          sessionId: agent.id,
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort ? { reasoningEffort: String(selection.reasoningEffort) } : {}),
        });
      } catch (error) {
        throw new Error(
          `model selection was rejected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    agent.model.select(selection);
    try {
      await (this.rootCtx.get('agentDefaultModel') as AgentDefaultModelConfig | undefined)?.saveSelection(selection);
    } catch {
      // The current-session switch already holds; default persistence is best effort.
    }
  }

  private hostSessionController(): ChannelHostSessionController | undefined {
    return this.rootCtx.get('sessionController') as ChannelHostSessionController | undefined;
  }

  /**
   * Agents configured through the bridge always have a recorded strategy.
   * Keep the deployment-wide mode as a compatibility fallback for direct
   * controller callers that have not installed the Agent-scoped hook.
   */
  private strategyFor(agent: Agent): ChannelModelSelectionMode {
    return this.strategies.get(agent.ctx) ?? this.mode;
  }

}
