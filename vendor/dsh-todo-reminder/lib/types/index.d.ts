import type { IncomingMessage } from 'node:http';
import { TodoService, type TodoServiceConfig } from './service.js';
export interface ChannelOwner {
    key: string;
    sessionId: string;
}
interface AgentLike {
    id: unknown;
}
interface ChannelSessions {
    ownerForAgent(agent: AgentLike): Promise<ChannelOwner>;
    assertWritable(agent: AgentLike): void;
    getSessionEntry(id: string): unknown;
    singleOwner(): Promise<ChannelOwner>;
    listOwners(): Promise<ChannelOwner[]>;
    notifyOwner(owner: ChannelOwner, text: string): Promise<void>;
}
interface Connection {
    admit(req: IncomingMessage): {
        rejection: 401 | 403;
    } | {
        peer: {
            principal: {
                kind: string;
            };
        };
    };
}
export interface TodoHostContext {
    webServer: {
        register(route: {
            kind: 'exact' | 'prefix';
            path: string;
            handler: unknown;
        }): () => void;
    };
    interval(callback: () => void, ms: number): () => void;
    effect(fn: () => (() => void) | void, label?: string): () => void;
    provide(name: string, value: unknown): unknown;
    tools: {
        register(definition: unknown): () => void;
    };
    channelSessions: ChannelSessions;
    connection: Connection;
    systemPrompt?: {
        section(opts: {
            name: string;
            order: number;
            text: string;
        }): () => void;
    };
}
export declare const name = "todo-reminder";
export declare const inject: string[];
export declare const TODO_GUIDANCE = "\u5DF2\u542F\u7528\u4E2A\u4EBA\u5F85\u529E\u5DE5\u5177\u3002\u53EA\u6709\u7528\u6237\u8981\u6C42\u6216\u672C\u4EBA\u5DF2\u5F00\u542F\u7684\u6BCF\u65E5\u65E9\u62A5\u8BA2\u9605\u624D\u5141\u8BB8\u8BFB\u53D6\u5F85\u529E\uFF1B\u4FEE\u6539\u4ECD\u987B\u7528\u6237\u8981\u6C42\uFF0C\u4E0D\u628A\u5F85\u529E\u5F53\u4F5C\u804A\u5929\u5386\u53F2\u3002\u7528\u6237\u8981\u6C42\u63D0\u9192\u65F6\u4F7F\u7528 personal_reminder\uFF0C\u5148\u7528 clock \u83B7\u53D6\u5317\u4EAC\u65F6\u95F4\uFF0C\u518D\u521B\u5EFA\u6216\u7BA1\u7406\u63D0\u9192\u3002\u63D0\u9192\u5230\u70B9\u53EA\u53D1\u9001\u901A\u77E5\uFF0C\u4E0D\u6267\u884C\u4EFB\u52A1\u3002\u7528\u6237\u8981\u6C42\u6BCF\u5929\u4E3B\u52A8\u751F\u6210\u5F85\u529E\u4E0E\u8D44\u8BAF\u65F6\u4F7F\u7528 personal_briefing\uFF0C\u4E0D\u80FD\u7528\u666E\u901A\u63D0\u9192\u5192\u5145\u81EA\u52A8\u751F\u6210\u3002";
export declare function ownerAdmission(connection: Connection | undefined, req: IncomingMessage): 200 | 401 | 403 | 503;
export declare function createTodoRuntime(ctx: TodoHostContext): {
    getForOwner: (owner: ChannelOwner) => TodoService;
    forAgent: (agent: AgentLike) => Promise<{
        owner: ChannelOwner;
        store: TodoService;
    }>;
    tick: () => Promise<void>;
};
export declare function apply(ctx: TodoHostContext, config?: TodoServiceConfig): void;
export { TodoService } from './service.js';
export type { TodoServiceConfig } from './service.js';
export type { ReminderEvent, ReminderStyle, TodoAddInput, TodoItem, TodoPatch, TodoSettings, TodoState } from './types.js';
