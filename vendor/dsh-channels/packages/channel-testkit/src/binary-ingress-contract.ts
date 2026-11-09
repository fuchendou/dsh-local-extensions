/**
 * Multi-channel binary ingress contract.
 *
 * `runBinaryIngressContract(options)` registers a vitest suite that drives an
 * adapter's inbound binary hydration with real platform fixtures and asserts
 * the three transport states:
 *
 * - `bytes`   — the adapter produced trusted `localData` bytes for the kind
 *               and the case claim matches `capabilities.media.inbound[kind]`
 *               (`capabilities.media.inbound[kind] === 'bytes'` must be proven
 *               by `part.localData.byteLength > 0` before emit);
 * - `locator` — the part keeps its platform locator (`resourceRef` or an
 *               http(s) `url`) with NO fabricated bytes, and any failure state
 *               present uses a stable, de-identified `BinaryIngressFailureCode`
 *               rather than a platform exception string;
 * - `failure` — the ingress failed with a stable binary ingress failure code
 *               while the text part is still delivered and the binary part is
 *               retained (failure semantics: text delivery is never blocked by
 *               a media failure).
 *
 * The runner is fixture-driven exactly like the adapters' own mapper/hydration
 * tests (`channel-telegram/test/adapter.test.ts`,
 * `channel-qq/test/image-hydration.test.ts`, `channel-dingtalk/test/
 * image-hydration.test.ts`): the caller supplies a `deliver(raw)` that pushes
 * the fixture's raw platform payload through the adapter's inbound entry
 * (mapper + hydration + `ctx.emit`) and returns the emitted `MessageReceived`
 * (or just the emitted parts). The runner loads the fixture itself via
 * `loadFixture`, so each case only names kind/expected/channel/stem.
 *
 * The runner intentionally does NOT deep-compare the delivered message against
 * `fixture.expected`: fixture `expected` snapshots the mapper output BEFORE
 * hydration (e.g. a Telegram image part carrying `resourceRef`), while the
 * contract under test is the post-hydration state. The §32 mode assertions
 * replace that raw equality check.
 *
 * The five built-in adapters register suites with this runner; individual
 * kinds may be skipped when no truthful platform fixture exists.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BINARY_KINDS } from '@wsz987/channel-core';
import type {
  BinaryIngressFailureCode,
  BinaryKind,
  ChannelAdapter,
  ChannelCapabilities,
  MessagePart,
  MessageReceived,
} from '@wsz987/channel-core';
import { loadFixture } from './fixture-loader.js';
import type { FixtureCase } from './fixture-loader.js';

/**
 * Stable, de-identified binary ingress failure codes asserted by the
 * `failure` (and `locator` explicit-status) modes. Mirrors the
 * `BinaryIngressFailureCode` union in channel-core; the type import keeps the
 * two in sync at compile time.
 */
export const BINARY_INGRESS_FAILURE_CODES: readonly BinaryIngressFailureCode[] = [
  'too-large',
  'download-failed',
  'decrypt-failed',
  'integrity-failed',
  'mime-invalid',
  'resource-unavailable',
] as const;

/** What ingress transport state one case must prove. */
export type BinaryIngressMode = 'bytes' | 'locator' | 'failure';

/** One fixture-driven binary ingress case (§32). */
export interface BinaryIngressCase {
  /** Binary part kind under test. */
  kind: BinaryKind;
  /**
   * The ingress state the adapter must prove for this fixture:
   * - `bytes`   — hydrated `localData` with `byteLength > 0`
   * - `locator` — platform locator retained, no fabricated bytes
   * - `failure` — stable `ingressFailure` with text still delivered
   */
  expected: BinaryIngressMode;
  /**
   * Fixture stem in `fixtures/<channel>/`. Defaults to `${kind}-inbound`
   * (e.g. `image-inbound`, `audio-inbound`) when omitted.
   */
  fixture?: string;
  /** Fixture directory channel id (e.g. `'telegram'`); must match the dir. */
  channel: string;
}

/** What `deliver()` returns: a full emitted event or just the emitted parts. */
export type DeliveredBinaryIngress = MessageReceived | { parts: MessagePart[] };

export interface RunBinaryIngressContractOptions {
  /** The adapter under test; only `id` and `capabilities` are read. */
  adapter: ChannelAdapter;
  /** The cases the suite verifies, in order. */
  cases: BinaryIngressCase[];
  /**
   * Adapter-specific inbound driver. It receives the fixture's raw platform
   * payload (`fixture.payload`) and returns the emitted
   * `message.received` event (or just its `parts`).
   *
   * This is the exact mechanism the adapters' own tests use: construct the
   * adapter with injectable transport/SDK fakes, start it in a test context
   * (`createTestContext`), deliver the raw platform event through the
   * adapter's inbound entry (mapper + hydration + `ctx.emit`), capture the
   * emitted event from a `ChannelService` listener, and return it:
   *
   * ```ts
   * deliver: async (raw) => {
   *   const service = new ChannelService(new Context());
   *   const ctx = createTestContext(service);
   *   // adapter-specific: wire the InboundProcessor / hydration with fakes
   *   const processor = new InboundProcessor({ ctx, meta, files });
   *   let captured: MessageReceived | undefined;
   *   service.on((event) => {
   *     if (event.type === 'message.received') captured = event;
   *   });
   *   await processor.handle(raw);
   *   if (!captured) throw new Error('no message.received emitted');
   *   return captured;
   * }
   * ```
   *
   * Returning `{ parts }` is the lighter alternative when constructing a full
   * event is not worth it. The delivered shape is validated with zod before
   * assertion (AGENTS.md 5.4).
   */
  deliver: (raw: unknown) => Promise<DeliveredBinaryIngress>;
  /**
   * When true (default), a case declaring `expected: 'bytes'` fails unless
   * `adapter.capabilities.media.inbound[kind] === 'bytes'` (the claim must be
   * backed by the directional capability). Set to `false` when
   * testing adapters that hydrate without yet declaring the media map.
   */
  assertCapabilityConsistency?: boolean;
  /**
   * Internal/advanced hook: replace the fixture loader. Defaults to the
   * testkit `loadFixture` reading `fixtures/<channel>/<stem>.json` from the
   * repository root. Tests can inject an in-memory store.
   */
  loadFixture?: (channel: string, name: string) => Promise<FixtureCase>;
}

/** Case definitions are external input — validate with zod (AGENTS.md 5.4). */
const binaryIngressCaseSchema = z.object({
  kind: z.enum(BINARY_KINDS, {
    error: 'binary ingress case kind must be one of image | file | audio | video',
  }),
  expected: z.enum(['bytes', 'locator', 'failure'], {
    error: "binary ingress case expected must be 'bytes' | 'locator' | 'failure'",
  }),
  fixture: z.string().optional(),
  channel: z.string().min(1, {
    error: 'binary ingress case channel must be a non-empty fixture directory id',
  }),
}).loose();

/** A loose part surface extracted from an unknown delivered value. */
export interface LooseBinaryPart {
  type: string;
  [key: string]: unknown;
}

/** deliver() output is a trust boundary — validate before reading fields. */
const deliveredSchema = z.union([
  z.object({ parts: z.array(z.unknown()) }).loose(),
  z.object({ message: z.object({ content: z.array(z.unknown()) }).loose() }).loose(),
]);

const partSchema = z.object({ type: z.string({ error: 'each part must carry a string type' }) }).loose();

/**
 * Extract the parts surface from a `deliver()` result. Returns the normalized
 * loose parts plus structural problems (invalid deliver shape, non-part
 * entries). When problems are non-empty the delivered value must not be
 * asserted against.
 */
export function extractDeliveredParts(delivered: unknown): { parts: LooseBinaryPart[]; problems: string[] } {
  const parsed = deliveredSchema.safeParse(delivered);
  if (!parsed.success) {
    return { parts: [], problems: ['deliver() must return a MessageReceived or { parts: MessagePart[] }'] };
  }
  // The schema already proved one of the two branches holds (parts: unknown[]
  // or message.content: unknown[]); the loose index signatures defeat `in`
  // narrowing, so re-view the parsed result explicitly.
  const shape = parsed.data as { parts?: unknown[]; message?: { content?: unknown[] } };
  const rawParts = Array.isArray(shape.parts) ? shape.parts : (shape.message?.content ?? []);
  const parts: LooseBinaryPart[] = [];
  const problems: string[] = [];
  for (const raw of rawParts) {
    const part = partSchema.safeParse(raw);
    if (!part.success) {
      problems.push('delivered content contains a value that is not a MessagePart (expected an object with a string type)');
      continue;
    }
    parts.push(part.data);
  }
  return { parts, problems };
}

/** Keys that must never appear on a binary part (no raw platform credential). */
const CREDENTIAL_FIELD_PATTERN = /token|secret|authorization/i;

/** A locator `url` must be a genuine http(s) URL (core `BinaryPartBase` rule). */
const HTTP_URL_PATTERN = /^https?:\/\//i;

function isNonEmptyBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 0;
}

function isStableIngressFailure(value: unknown): value is BinaryIngressFailureCode {
  return typeof value === 'string' && (BINARY_INGRESS_FAILURE_CODES as readonly string[]).includes(value);
}

function checkCredentialFree(part: LooseBinaryPart, label: string): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(part)) {
    if (CREDENTIAL_FIELD_PATTERN.test(key)) {
      problems.push(`${label}: ${part.type} part leaks a platform credential through the '${key}' field`);
    }
  }
  if (typeof part.url === 'string' && CREDENTIAL_FIELD_PATTERN.test(part.url)) {
    problems.push(`${label}: ${part.type} part url embeds a platform credential`);
  }
  return problems;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Evaluate one binary ingress case against a delivered message (pure, no
 * vitest dependency). Returns a list of human-readable failure messages —
 * `[]` means the case passed.
 *
 * Assertions:
 * - `bytes`: the `kind` part is present with hydrated
 *   `localData` (`byteLength > 0`); no raw platform credential fields/url;
 *   when `options.assertCapabilityConsistency !== false` a bytes case must be
 *   backed by `capabilities.media.inbound[kind] === 'bytes'`.
 * - `locator`: the `kind` part is present with a
 *   `resourceRef` or an http(s) `url`; `localData` is undefined (no fake
 *   bytes); failure/status is explicit — a present `ingressFailure` must be a
 *   stable `BinaryIngressFailureCode` (a locator-only part without any
 *   failure code is the allowed "locator deferred" state).
 * - `failure`: the delivered message still contains a
 *   text part, the `kind` part is retained, and its `ingressFailure` is one of
 *   the stable `BinaryIngressFailureCode`s.
 *
 * All modes additionally reject credential leaks on the `kind` parts and
 * verify the whole delivered shape with zod (AGENTS.md 5.4).
 */
export function evaluateBinaryIngressCase(
  cas: BinaryIngressCase,
  fixture: Readonly<Pick<FixtureCase, 'name'>>,
  delivered: unknown,
  capabilities: ChannelCapabilities,
  options: { assertCapabilityConsistency?: boolean } = {},
): string[] {
  const label = `${cas.channel}/${fixture.name ?? `${cas.kind}-inbound`}`;
  const problems: string[] = [];

  // Consistency: a bytes claim in a case must be backed by the directional
  // capability (capabilities.media.inbound[kind] === 'bytes').
  if (cas.expected === 'bytes' && options.assertCapabilityConsistency !== false) {
    const claimed = capabilities.media?.inbound?.[cas.kind];
    if (claimed !== 'bytes') {
      problems.push(
        `${label}: expected 'bytes' but capabilities.media.inbound.${cas.kind} is ${claimed ?? 'not declared'} — a bytes case must be backed by a 'bytes' media claim (set assertCapabilityConsistency: false to relax)`,
      );
    }
  }

  const { parts, problems: shapeProblems } = extractDeliveredParts(delivered);
  problems.push(...shapeProblems);
  if (shapeProblems.length > 0) return problems;

  const kindParts = parts.filter((part) => part.type === cas.kind);
  if (kindParts.length === 0) {
    problems.push(`${label}: no ${cas.kind} part in the delivered message content`);
    return problems;
  }

  for (const part of kindParts) {
    problems.push(...checkCredentialFree(part, label));
  }

  switch (cas.expected) {
    case 'bytes':
      for (const part of kindParts) {
        if (!isNonEmptyBytes(part.localData)) {
          problems.push(`${label}: ${cas.kind} part missing hydrated localData (expected byteLength > 0)`);
        }
      }
      break;
    case 'locator':
      for (const part of kindParts) {
        const hasRef = typeof part.resourceRef === 'string' && part.resourceRef.length > 0;
        const hasUrl = typeof part.url === 'string' && HTTP_URL_PATTERN.test(part.url);
        if (!hasRef && !hasUrl) {
          problems.push(`${label}: ${cas.kind} locator part must carry a resourceRef or an http(s) url`);
        }
        if (part.localData !== undefined) {
          problems.push(`${label}: ${cas.kind} locator part must not fabricate localData bytes`);
        }
        if (part.ingressFailure !== undefined && !isStableIngressFailure(part.ingressFailure)) {
          problems.push(
            `${label}: ${cas.kind} locator part failure state must be a stable BinaryIngressFailureCode (got '${String(part.ingressFailure)}')`,
          );
        }
      }
      break;
    case 'failure':
      if (!parts.some((part) => part.type === 'text')) {
        problems.push(`${label}: a failed binary ingress must still emit a text part`);
      }
      for (const part of kindParts) {
        if (!isStableIngressFailure(part.ingressFailure)) {
          problems.push(
            `${label}: ${cas.kind} part must retain a stable BinaryIngressFailureCode (one of ${BINARY_INGRESS_FAILURE_CODES.join(' | ')}) — got ${part.ingressFailure === undefined ? 'none' : `'${String(part.ingressFailure)}'`}`,
          );
        }
      }
      break;
  }
  return problems;
}

/**
 * Register a vitest suite that runs every case through the adapter's inbound
 * binary hydration and asserts the §32 state the case declares. Call at the
 * top level of a vitest test file (mirroring `runChannelAdapterContract`).
 */
export function runBinaryIngressContract(options: RunBinaryIngressContractOptions): void {
  const { adapter, cases, deliver, assertCapabilityConsistency = true } = options;
  const loadCaseFixture = options.loadFixture ?? loadFixture;

  describe(`binary ingress contract: ${adapter.id}`, () => {
    for (const rawCase of cases) {
      const parsed = binaryIngressCaseSchema.safeParse(rawCase);
      if (!parsed.success) {
        it(`invalid case definition: ${JSON.stringify(rawCase)}`, () => {
          expect.fail(`binary ingress case is invalid: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')}`);
        });
        continue;
      }
      const cas = parsed.data;
      const fixtureStem = cas.fixture ?? `${cas.kind}-inbound`;

      describe(`case: ${cas.channel}/${fixtureStem} — ${cas.expected} ${cas.kind}`, () => {
        it('hydrated binary ingress satisfies the multi-channel binary contract (§32)', async () => {
          let fixture: FixtureCase;
          try {
            fixture = await loadCaseFixture(cas.channel, fixtureStem);
          } catch (error) {
            expect.fail(`could not load fixture fixtures/${cas.channel}/${fixtureStem}.json: ${errorMessage(error)}`);
            return;
          }
          const delivered = await deliver(fixture.payload);
          const problems = evaluateBinaryIngressCase(cas, fixture, delivered, adapter.capabilities, {
            assertCapabilityConsistency,
          });
          expect(problems).toEqual([]);
        });
      });
    }
  });
}
