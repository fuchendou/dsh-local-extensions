# @wsz987/channel-files

**Generic Attachment Compatibility Backend** for DeepSeek Harness Channels.

Stores session-scoped non-image attachments and preserves legacy readable
extraction while Harness does not yet provide a native generic attachment
contract. Inbound PDF / DOCX / XLSX / text files are stored and exposed to the
model through the `read_channel_attachment` tool — without routing raw platform
payloads through the prompt.

Legacy extraction (PDF / DOCX / XLSX / TXT) is **compatibility behavior**: it
keeps working for existing users via `read_channel_attachment`, and no new
"understanding" features (ASR, video analysis, OCR, PPTX parsing) are added
here — those belong to Harness skills, plugins or MCP.

## Install

```bash
pnpm add @wsz987/channel-files
```

It is included in the `@wsz987/dsh-channels` bundle by default. To disable the
extension, remove the `channels-files` plugin from the bundle patch; Harness
native images and plain text messages keep working.

## Features

| Area | Detail |
| --- | --- |
| Storage | Private, session-scoped asset store under the channel data directory; reads enforce the channel Session ACL |
| Extraction (compatibility) | Legacy PDF (`unpdf`), DOCX (`mammoth`), XLSX (`xlsx`), plain text — compatibility behavior, no new understanding features |
| Tool | `read_channel_attachment` (compatibility tool) installs on the agent so models can read stored files |
| Limits | 100 MiB inbound per file · 32 MiB parser input · 5 MiB extracted text output |

## How it works

`ChannelFileService` implements the `ChannelAttachmentProvider` port from
`@wsz987/channel-harness` (the former `ChannelFileProvider` name is kept as a
deprecated alias):

```ts
ctx.channelFiles.store(channelAttachmentContext, binaryPart); // store + extract
ctx.channelFiles.resolveAttachment(attachmentId, sessionId);  // Session ACL enforced
await ctx.channelFiles.installCompatibilityTools(agentContext); // add the read tool
```

## Roadmap

Harness currently has no native generic attachment surface. Until it ships one,
this package remains the generic attachment backend. Ahead of that, the following
infrastructure exists **default-off** and activates only via public capability
detection once the official API appears:

- Attachment Catalog v2 (`attachments/catalog/v2`) — logical `att-*` id → backend
  locator index, kept separate from the legacy v1 tree;
- native capability seam (`src/backends/harness-native.ts`) — interface + fake
  only, never fooled by the image-only `ctx.attachments` service;
- lazy copy + verify migration (`src/migration/`) — a failed migration keeps the
  legacy backend authoritative.

Legacy `attachments/v1` data remains permanently readable and is never rewritten
or deleted on upgrade.

## Development

```bash
pnpm --filter @wsz987/channel-files build
pnpm --filter @wsz987/channel-files typecheck
pnpm --filter @wsz987/channel-files test
```

## Related

- [Repository root](../../README.md)
- [Architecture design](../../docs/architecture.md)

## License

[MIT](../../LICENSE)
