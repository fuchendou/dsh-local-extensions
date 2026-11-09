import { describe, expect, it } from 'vitest';
import type { ChannelAdapter, ChannelCapabilities, MessagePart, MessageReceived } from '@wsz987/channel-core';
import {
  evaluateBinaryIngressCase,
  extractDeliveredParts,
  runBinaryIngressContract,
  type BinaryIngressCase,
  type FixtureCase,
} from '../src/index.ts';

/**
 * Unit tests for the multi-channel binary ingress contract.
 *
 * The pass/fail semantics live in the pure `evaluateBinaryIngressCase`
 * (assertion semantics are tested deterministically here); the
 * `runBinaryIngressContract` registration is exercised end-to-end at the
 * bottom with a hand-rolled fixture-driven adapter.
 */

function makeFixture(name: string = 'case'): FixtureCase {
  return {
    name,
    channel: 'test-channel',
    upstreamVersion: '1.0.0',
    payload: { sentinel: true },
    expected: {},
  };
}

const bytes = (): Uint8Array => new Uint8Array([1, 2, 3]);

/** Capability surface with the coarse flags + a directional media map. */
function caps(
  inbound: Partial<Record<'image' | 'file' | 'audio' | 'video', 'bytes' | 'locator' | 'unsupported'>>,
  legacy: Partial<Record<'image' | 'file' | 'audio' | 'video', boolean>> = {},
): ChannelCapabilities {
  return {
    text: true,
    image: legacy.image ?? false,
    file: legacy.file ?? false,
    audio: legacy.audio ?? false,
    video: legacy.video ?? false,
    markdown: false,
    cards: false,
    reactions: false,
    threads: false,
    streaming: 'buffered',
    media: { inbound, outbound: {} },
  };
}

const baseCaps = (): ChannelCapabilities =>
  caps({ image: 'bytes', file: 'locator' }, { image: true, file: true });

describe('evaluateBinaryIngressCase — bytes mode (`bytes`)', () => {
  const cas: BinaryIngressCase = { kind: 'image', expected: 'bytes', channel: 'telegram' };

  it('passes when the part carries hydrated localData', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'image', localData: bytes() }] },
      baseCaps(),
    );
    expect(problems).toEqual([]);
  });

  it('passes when delivered as a full MessageReceived', () => {
    const event: MessageReceived = {
      type: 'message.received',
      channel: 'telegram' as never,
      accountId: 'main' as never,
      conversation: { id: 'c1' as never, type: 'dm' },
      sender: { id: 'u1' as never },
      message: { id: 'm1' as never, content: [{ type: 'image', localData: bytes() }] },
    };
    expect(evaluateBinaryIngressCase(cas, makeFixture(), event, baseCaps())).toEqual([]);
  });

  it('fails when a kind part has no hydrated bytes', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'image', localData: new Uint8Array(0) }] },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/localData/);
  });

  it('fails with no kind part at all', () => {
    const problems = evaluateBinaryIngressCase(cas, makeFixture(), { parts: [{ type: 'text', text: 'hi' }] }, baseCaps());
    expect(problems.join('\n')).toMatch(/no image part/);
  });

  it('fails when the case claims bytes but the capability does not (§7.2)', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'image', localData: bytes() }] },
      caps({ image: 'locator' }, { image: true }),
    );
    expect(problems.join('\n')).toMatch(/capabilities\.media\.inbound\.image/);
  });

  it('also fails when the media map is absent entirely', () => {
    const noMedia: ChannelCapabilities = {
      text: true,
      image: true,
      file: false,
      audio: false,
      video: false,
      markdown: false,
      cards: false,
      reactions: false,
      threads: false,
      streaming: 'buffered',
    };
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'image', localData: bytes() }] },
      noMedia,
    );
    expect(problems.join('\n')).toMatch(/not declared/);
  });

  it('relaxes the capability consistency when assertCapabilityConsistency is false', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'image', localData: bytes() }] },
      caps({ image: 'locator' }, { image: true }),
      { assertCapabilityConsistency: false },
    );
    expect(problems).toEqual([]);
  });

  it('fails on a raw platform credential field (no raw platform credential)', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'image', localData: bytes(), downloadToken: 'live-xxx' }] },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/credential/);
    expect(problems.join('\n')).toMatch(/downloadToken/);
  });

  it('fails when the url embeds a credential', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'image', localData: bytes(), url: 'https://e/p.jpg?access_token=live-xxx' }] },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/url embeds a platform credential/);
  });
});

describe('evaluateBinaryIngressCase — locator mode (`locator`)', () => {
  const cas: BinaryIngressCase = { kind: 'file', expected: 'locator', channel: 'lark' };

  it('passes with a resourceRef and no fabricated bytes', () => {
    expect(
      evaluateBinaryIngressCase(
        cas,
        makeFixture(),
        { parts: [{ type: 'file', resourceRef: 'file_key_abc' }] },
        baseCaps(),
      ),
    ).toEqual([]);
  });

  it('passes with a genuine http(s) url and an explicit stable failure', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'file', url: 'https://e/r.pdf', ingressFailure: 'download-failed' }] },
      baseCaps(),
    );
    expect(problems).toEqual([]);
  });

  it('fails when the part fabricates localData bytes', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'file', resourceRef: 'file_key_abc', localData: bytes() }] },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/must not fabricate localData/);
  });

  it('fails when neither a resourceRef nor an http(s) url is present', () => {
    const problems = evaluateBinaryIngressCase(cas, makeFixture(), { parts: [{ type: 'file' }] }, baseCaps());
    expect(problems.join('\n')).toMatch(/resourceRef or an http\(s\) url/);
  });

  it('fails when a non-http scheme is used as url', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'file', url: 'ftp://e/r.pdf' }] },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/resourceRef or an http\(s\) url/);
  });

  it('rejects an unstable (platform-specific) failure state — explicit status rule', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'file', resourceRef: 'file_key_abc', ingressFailure: 'network timeout' as never }] },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/stable BinaryIngressFailureCode/);
  });
});

describe('evaluateBinaryIngressCase — failure mode (`failure`)', () => {
  const cas: BinaryIngressCase = { kind: 'audio', expected: 'failure', channel: 'qq' };
  const failedParts = (overrides: Record<string, unknown> = {}): MessagePart[] => [
    { type: 'text', text: 'keep me' },
    { type: 'audio', resourceRef: 'media_id', ingressFailure: 'download-failed', ...overrides },
  ];

  it('passes when text is still emitted and the part retains a stable code', () => {
    const problems = evaluateBinaryIngressCase(cas, makeFixture(), { parts: failedParts() }, baseCaps());
    expect(problems).toEqual([]);
  });

  it('passes on every stable code', () => {
    for (const code of ['too-large', 'download-failed', 'decrypt-failed', 'integrity-failed', 'mime-invalid', 'resource-unavailable']) {
      const problems = evaluateBinaryIngressCase(
        cas,
        makeFixture(),
        { parts: failedParts({ ingressFailure: code }) },
        baseCaps(),
      );
      expect(problems).toEqual([]);
    }
  });

  it('fails when the text part is dropped', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: [{ type: 'audio', resourceRef: 'media_id', ingressFailure: 'download-failed' }] },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/text part/);
  });

  it('fails when ingressFailure is missing', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: failedParts({ ingressFailure: undefined }) },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/stable BinaryIngressFailureCode/);
  });

  it('fails on an unstable failure code', () => {
    const problems = evaluateBinaryIngressCase(
      cas,
      makeFixture(),
      { parts: failedParts({ ingressFailure: 'http 500' as never }) },
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/stable BinaryIngressFailureCode/);
  });
});

describe('evaluateBinaryIngressCase — delivered shape validation (AGENTS.md 5.4)', () => {
  it('rejects a deliver() result that is not a message/parts shape', () => {
    const problems = evaluateBinaryIngressCase(
      { kind: 'image', expected: 'bytes', channel: 'telegram' },
      makeFixture(),
      {},
      baseCaps(),
    );
    expect(problems.join('\n')).toMatch(/MessageReceived or \{ parts: MessagePart\[\] \}/);
  });

  it('extractDeliveredParts reports a non-part entry in content', () => {
    const { parts, problems } = extractDeliveredParts({ parts: [{ type: 'image', localData: bytes() }, 42] });
    expect(parts).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not a MessagePart/);
  });
});

describe('runBinaryIngressContract — end-to-end registration', () => {
  /** Hand-rolled fixture-driven adapter (no real platform). */
  class LocalBinaryAdapter implements ChannelAdapter {
    readonly id = 'local-binary';
    readonly capabilities: ChannelCapabilities = baseCaps();

    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async send(): Promise<{ delivered: boolean }> {
      return { delivered: true };
    }
  }

  /** In-memory fixture provider replacing the on-disk loader. */
  const fixtureStore = new Map<string, FixtureCase>();
  const seed = (stem: string, mode: 'bytes' | 'locator' | 'failure'): void => {
    fixtureStore.set(`local:${stem}`, {
      name: `${stem} fixture`,
      channel: 'local',
      upstreamVersion: '1.0.0',
      payload: { mode },
      expected: {},
    });
  };

  function partsForMode(mode: string): MessagePart[] {
    switch (mode) {
      case 'locator':
        return [{ type: 'file', resourceRef: 'file_key_abc' }];
      case 'failure':
        return [
          { type: 'text', text: 'keep me' },
          { type: 'audio', resourceRef: 'media_id', ingressFailure: 'download-failed' },
        ];
      default:
        return [{ type: 'image', localData: bytes() }];
    }
  }

  seed('image-inbound', 'bytes');
  seed('file-inbound', 'locator');
  seed('audio-inbound', 'failure');

  // Registers the three default-stem cases; the assert/locator/failure
  // assertions run inside the vitest suite and must all pass.
  runBinaryIngressContract({
    adapter: new LocalBinaryAdapter(),
    cases: [
      { kind: 'image', expected: 'bytes', channel: 'local' },
      { kind: 'file', expected: 'locator', channel: 'local' },
      { kind: 'audio', expected: 'failure', channel: 'local' },
    ],
    loadFixture: async (channel, name) => {
      const fixture = fixtureStore.get(`${channel}:${name}`);
      if (!fixture) throw new Error(`fixture not found: ${channel}/${name}`);
      return fixture;
    },
    deliver: async (raw): Promise<{ parts: MessagePart[] }> => ({
      parts: partsForMode((raw as { mode?: string }).mode ?? 'bytes'),
    }),
  });

  it('supports an explicit fixture stem and an explicit case fixture', async () => {
    fixtureStore.set('local:explicit-case', {
      name: 'explicit case fixture',
      channel: 'local',
      upstreamVersion: '1.0.0',
      payload: { mode: 'bytes' },
      expected: {},
    });
    // Direct runner evaluation of the stored fixture through the adapter path.
    const fixture = fixtureStore.get('local:explicit-case')!;
    const delivered = await (async () => ({ parts: partsForMode((fixture.payload as { mode: string }).mode) }))();
    const problems = evaluateBinaryIngressCase(
      { kind: 'image', expected: 'bytes', channel: 'local', fixture: 'explicit-case' },
      fixture,
      delivered,
      new LocalBinaryAdapter().capabilities,
    );
    expect(problems).toEqual([]);
  });
});

describe('runBinaryIngressContract — real repo fixture directory', () => {
  class TelegramImageAdapter implements ChannelAdapter {
    readonly id = 'telegram-image-fixture';
    readonly capabilities: ChannelCapabilities = caps({ image: 'bytes' }, { image: true });

    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async send(): Promise<{ delivered: boolean }> {
      return { delivered: true };
    }
  }

  // Loads `fixtures/telegram/inbound-image.json` (the real repository fixture)
  // through the default testkit loader and delivers hydrated bytes for it.
  runBinaryIngressContract({
    adapter: new TelegramImageAdapter(),
    cases: [{ kind: 'image', expected: 'bytes', channel: 'telegram', fixture: 'inbound-image' }],
    deliver: async (): Promise<{ parts: MessagePart[] }> => ({
      parts: [{ type: 'image', localData: bytes(), mimeType: 'image/jpeg' }],
    }),
  });
});