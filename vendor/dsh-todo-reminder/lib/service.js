/**
 * TodoService：待办 CRUD + 到期提醒调度 + 设置 + 订阅（SSE 推送源）。纯框架无关
 * （不 extend cordis Service、不依赖 @deepseek-ai/* 运行时），只依赖 node: 内置 +
 * 本地 store/types，因此 host 半 tsc 产物自包含、任何装配路径都能加载。
 * @module dsh-todo-reminder/service
 */
import { randomUUID } from 'node:crypto';
import { loadDoc, saveDoc, todoDataFile } from './store.js';
import { clampNumber, DEFAULT_TODO_SETTINGS, isReminderStyle, REMINDER_STYLES, sanitizeMinutesList } from './types.js';
/** 默认调度间隔：5 秒。 */
export const DEFAULT_TICK_MS = 5000;
export class TodoService {
    doc;
    committed;
    dataFile;
    originSessionId;
    subscribers = new Set();
    constructor(dataFile) {
        this.dataFile = dataFile ?? todoDataFile();
        this.doc = loadDoc(this.dataFile);
        this.committed = structuredClone(this.doc);
    }
    setOriginSession(sessionId) { this.originSessionId = sessionId; }
    allTodos() { return this.doc.todos.map((todo) => ({ ...todo })); }
    pendingDeliveries() { return this.doc.reminders.filter((r) => r.originSessionId && !r.delivered).map((r) => ({ ...r })); }
    confirmDelivery(id) {
        const event = this.doc.reminders.find((r) => r.id === id);
        if (!event)
            return;
        event.delivered = true;
        this.flush();
    }
    /** 订阅状态变化（SSE 推送用）。返回取消订阅函数。 */
    subscribe(listener) {
        this.subscribers.add(listener);
        return () => {
            this.subscribers.delete(listener);
        };
    }
    /** 完整状态快照。 */
    state() {
        return {
            todos: this.doc.todos.filter((t) => !t.archived).map((t) => ({ ...t })),
            reminders: this.doc.reminders.filter((r) => !r.dismissed).map((r) => ({ ...r })),
            settings: this.settings(),
            now: Date.now(),
        };
    }
    /** 新建待办。 */
    add(input) {
        const title = (input.title ?? '').trim();
        if (title === '')
            throw new Error('title-empty');
        const todo = {
            id: randomUUID(),
            title,
            note: (input.note ?? '').trim(),
            done: false,
            createdAt: Date.now(),
            dueAt: typeof input.dueAt === 'number' && Number.isFinite(input.dueAt) ? input.dueAt : undefined,
            reminderStyle: isReminderStyle(input.reminderStyle) ? input.reminderStyle : 'info',
            confirmOnComplete: input.confirmOnComplete === true,
            reminded: false,
            originSessionId: input.originSessionId ?? this.originSessionId,
            repeat: input.repeat,
        };
        this.doc.todos.unshift(todo);
        this.flush();
        return { ...todo };
    }
    /** 更新待办字段。 */
    update(id, patch) {
        const todo = this.doc.todos.find((t) => t.id === id);
        if (todo === undefined)
            return null;
        if (typeof patch.title === 'string') {
            const title = patch.title.trim();
            if (title === '')
                throw new Error('title-empty');
            todo.title = title;
        }
        if (typeof patch.note === 'string')
            todo.note = patch.note.trim();
        // 只有显式带上 dueAt 键才动提醒时间：缺省键表示「本次不改」，
        // 显式 undefined 表示「清空」。用 in 判断区分二者，否则改标题会连带清掉提醒。
        if ('dueAt' in patch) {
            todo.dueAt = typeof patch.dueAt === 'number' && Number.isFinite(patch.dueAt) ? patch.dueAt : undefined;
            todo.reminded = false;
            todo.snoozedUntil = undefined;
        }
        if (isReminderStyle(patch.reminderStyle))
            todo.reminderStyle = patch.reminderStyle;
        if (typeof patch.confirmOnComplete === 'boolean')
            todo.confirmOnComplete = patch.confirmOnComplete;
        if (typeof patch.done === 'boolean') {
            todo.done = patch.done;
            todo.completedAt = patch.done ? Date.now() : undefined;
            if (patch.done)
                this.clearRemindersFor(id);
        }
        if (typeof patch.paused === 'boolean')
            todo.paused = patch.paused;
        if (typeof patch.archived === 'boolean') {
            todo.archived = patch.archived;
            if (patch.archived)
                this.clearRemindersFor(id);
        }
        this.flush();
        return { ...todo };
    }
    /** 删除待办（并清理其提醒）。 */
    remove(id) {
        const todo = this.doc.todos.find((t) => t.id === id);
        if (!todo)
            return;
        todo.archived = true;
        this.clearRemindersFor(id);
        this.flush();
    }
    /** 完成待办（并清理其提醒）。 */
    complete(id) {
        const todo = this.doc.todos.find((t) => t.id === id);
        if (todo === undefined)
            return null;
        todo.done = true;
        todo.completedAt = Date.now();
        todo.reminded = true;
        todo.snoozedUntil = undefined;
        this.clearRemindersFor(id);
        this.flush();
        return { ...todo };
    }
    /** 稍后提醒：把已触发的提醒延后 minutes 分钟。 */
    snooze(id, minutes) {
        const todo = this.doc.todos.find((t) => t.id === id);
        if (todo === undefined)
            return null;
        const delayMs = Math.max(0, Math.min(24 * 60, minutes)) * 60_000;
        todo.snoozedUntil = Date.now() + delayMs;
        todo.reminded = false;
        // 撤下当前提醒事件；snooze 到期后由 tick 重新触发。
        this.clearRemindersFor(id);
        this.flush();
        return { ...todo };
    }
    /** 忽略一条提醒（确认已看到，不再提醒）。 */
    dismissReminder(reminderId) {
        const event = this.doc.reminders.find((r) => r.id === reminderId);
        if (!event)
            return;
        event.dismissed = true;
        this.flush();
    }
    /** 更新用户设置。 */
    setSettings(patch) {
        if (typeof patch.soundByStyle === 'object' && patch.soundByStyle !== null) {
            const sbs = patch.soundByStyle;
            for (const key of REMINDER_STYLES) {
                if (typeof sbs[key] === 'boolean')
                    this.doc.settings.soundByStyle[key] = sbs[key];
            }
        }
        if (Array.isArray(patch.snoozeMinutes)) {
            const cleaned = sanitizeMinutesList(patch.snoozeMinutes);
            this.doc.settings.snoozeMinutes = cleaned.length > 0 ? cleaned : [...DEFAULT_TODO_SETTINGS.snoozeMinutes];
        }
        if (typeof patch.sound === 'object' && patch.sound !== null) {
            const snd = patch.sound;
            if (typeof snd.inPage === 'boolean')
                this.doc.settings.sound.inPage = snd.inPage;
            if (snd.volume !== undefined)
                this.doc.settings.sound.volume = clampNumber(snd.volume, 0, 1, this.doc.settings.sound.volume);
            if (snd.dangerRepeat !== undefined) {
                this.doc.settings.sound.dangerRepeat = Math.round(clampNumber(snd.dangerRepeat, 1, 5, this.doc.settings.sound.dangerRepeat));
            }
        }
        if (typeof patch.dock === 'object' && patch.dock !== null) {
            const dock = patch.dock;
            if (typeof dock.enabled === 'boolean')
                this.doc.settings.dock.enabled = dock.enabled;
            if (typeof dock.showNext === 'boolean')
                this.doc.settings.dock.showNext = dock.showNext;
        }
        this.flush();
        return this.settings();
    }
    /** 当前设置（深拷贝）。 */
    settings() {
        return {
            soundByStyle: { ...this.doc.settings.soundByStyle },
            snoozeMinutes: [...this.doc.settings.snoozeMinutes],
            sound: { ...this.doc.settings.sound },
            dock: { ...this.doc.settings.dock },
        };
    }
    /**
     * 调度 tick：扫描到期且未触发的待办，生成提醒事件。
     * @param now - 当前 epoch ms。
     */
    tick(now) {
        let changed = false;
        for (const todo of this.doc.todos) {
            if (todo.done || todo.archived || todo.paused || todo.dueAt === undefined)
                continue;
            if (todo.reminded && todo.snoozedUntil === undefined)
                continue;
            if ((todo.snoozedUntil ?? todo.dueAt) > now)
                continue;
            todo.reminded = !todo.repeat;
            todo.snoozedUntil = undefined;
            this.doc.reminders.push({
                id: randomUUID(),
                todoId: todo.id,
                title: todo.title,
                style: todo.reminderStyle,
                firedAt: now,
                originSessionId: todo.originSessionId,
                delivered: false,
            });
            if (todo.repeat && todo.dueAt <= now) {
                const period = (todo.repeat === 'daily' ? 1 : 7) * 24 * 60 * 60_000;
                todo.dueAt += (Math.floor((now - todo.dueAt) / period) + 1) * period;
            }
            changed = true;
        }
        if (changed)
            this.flush();
    }
    clearRemindersFor(todoId) {
        this.doc.reminders = this.doc.reminders.filter((r) => r.todoId !== todoId);
    }
    flush() {
        try {
            saveDoc(this.doc, this.dataFile);
        }
        catch (error) {
            this.doc = structuredClone(this.committed);
            throw error;
        }
        this.committed = structuredClone(this.doc);
        this.notify();
    }
    notify() {
        const state = this.state();
        for (const listener of this.subscribers) {
            try {
                listener(state);
            }
            catch {
                // 单个订阅者异常不得拖垮其它推送。
            }
        }
    }
}
//# sourceMappingURL=service.js.map