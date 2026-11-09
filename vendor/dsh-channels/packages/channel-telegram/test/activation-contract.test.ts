import { describe, expect, it } from 'vitest';
import { runActivationContract } from '@wsz987/channel-testkit';
import mentionedFixture from '../../../fixtures/telegram/inbound-group-mentioned.json' with { type: 'json' };
import unmentionedFixture from '../../../fixtures/telegram/inbound-group-unmentioned.json' with { type: 'json' };
import { mapInbound, type TelegramInboundMeta } from '../src/index.ts';

const meta: TelegramInboundMeta = {
  channel: 'telegram' as never,
  accountId: 'main' as never,
  bot: { id: 1, username: 'proof_bot' },
};

runActivationContract({
  withMention: mapInbound(mentionedFixture.payload, meta),
  withoutMention: mapInbound(unmentionedFixture.payload, meta),
});

function groupMessage(overrides: Record<string, unknown> = {}): unknown {
  return {
    update_id: 1020,
    message: {
      message_id: 520,
      date: 1700000020,
      chat: { id: -100200300, type: 'group', title: 'Harness Lab' },
      from: { id: 400500600, is_bot: false, first_name: 'Alice' },
      text: 'hello',
      ...overrides,
    },
  };
}

describe('Telegram mention activation mapping', () => {
  it('recognizes a text_mention addressed to the bot id', () => {
    const event = mapInbound(groupMessage({
      text: 'Proof',
      entities: [{
        type: 'text_mention',
        offset: 0,
        length: 5,
        user: { id: 1, is_bot: true, first_name: 'Proof' },
      }],
    }), meta);

    expect(event.message.activation?.mentionedBot).toBe(true);
  });

  it('recognizes an addressed bot command', () => {
    const event = mapInbound(groupMessage({
      text: '/help@Proof_Bot',
      entities: [{ type: 'bot_command', offset: 0, length: 15 }],
    }), meta);

    expect(event.message.activation?.mentionedBot).toBe(true);
  });

  it('recognizes a mention in a media caption', () => {
    const event = mapInbound(groupMessage({
      text: undefined,
      caption: '@Proof_Bot inspect this',
      caption_entities: [{ type: 'mention', offset: 0, length: 10 }],
      photo: [{ file_id: 'photo-1', width: 100, height: 100 }],
    }), meta);

    expect(event.message.activation?.mentionedBot).toBe(true);
  });

  it('emits a strict false fact when only bot id is available and no text_mention matches', () => {
    const event = mapInbound(groupMessage(), { ...meta, bot: { id: 1 } });

    expect(event.message.activation?.mentionedBot).toBe(false);
  });

  it('does not add group activation facts to direct messages', () => {
    const event = mapInbound({
      update_id: 1021,
      message: {
        message_id: 521,
        chat: { id: 400500600, type: 'private', first_name: 'Alice' },
        from: { id: 400500600, is_bot: false, first_name: 'Alice' },
        text: '@Proof_Bot hello',
        entities: [{ type: 'mention', offset: 0, length: 10 }],
      },
    }, meta);

    expect(event.message.activation).toBeUndefined();
  });
});
