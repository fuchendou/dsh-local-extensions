# When a PDF job is beyond this pack

State the missing capability, what you can still deliver, and how the user resolves it. Never answer with a bare "unsupported".

| Missing capability | Still possible | Resolution |
| --- | --- | --- |
| **Scanned pages with no text layer** — words are pixels only; `render_pages.py` reports `chars: 0` | Render, crop with `read_image`, transcribe; redact image pixels with `--images pixels`; rebuild the page from the transcription | The user supplies a text-based copy, or runs OCR where they have it — this runtime has no OCR engine |
| **Encrypted or password-protected files** — pypdf/PyMuPDF need the password; every script here exits with "encrypted" and does no work | Nothing until the file opens | Ask the user to decrypt first, then re-run. Never write a password into a command line that will be logged. |
| **Signing and certificates** — no certificate, signer, or signature field; editing a signed file invalidates its signature | Fill unsigned fields, rebuild the content, deliver unsigned — and say the signature is gone | Signing happens in a tool with a certificate, after the content is final |
| **Paragraph-level re-editing** — no paragraph model; the content stream is positioned glyphs and paths | Replace a line or block in place (`tasks/annotations.md`), remove a block, stamp a note | Reflow means rebuilding from a spec with the corrected text — say it was rebuilt, not patched |
| **Lexical repair of broken files** — a damaged xref may render in viewers but fail strict parsers; never emit an empty document | Report the parse error; ask the user to open and re-save in a reader (which repairs it), then re-run | Tell whichever tool produced the file about the corruption |
| **Tagged PDF and accessibility remediation** — the structure tree can be read but not authored reliably; a visual edit adds no tags | Keep the visual result correct and say the file is untagged | Remediation needs an authoring tool that writes the structure tree |
| **PDF/A and archival conformance** — font embedding, metadata schemas, and colour profiles are not validated here | Many PDF/A inputs survive a page-level edit and stay close, but claiming conformance would be a guess | Validate with a dedicated PDF/A checker before delivery |
| **Creating or restructuring form fields** — pypdf fills existing fields; a new interactive field needs a correct `/AP` state map, far beyond a fill | Stamp labels and values at coordinates so the printed result looks filled | An authoring tool for interactive forms, or accept non-interactive output and say so |
