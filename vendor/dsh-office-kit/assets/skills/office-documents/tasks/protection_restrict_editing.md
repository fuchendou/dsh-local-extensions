# Restrict editing

Restrictions live in `w:documentProtection` inside `word/settings.xml`. Modes: `readOnly`, `comments`, `trackedChanges`, `forms`, each with `enforcement`. This is a guardrail against accidental edits, not encryption: a determined reader can remove it.

## Set

```bash
"<python>" "<skill>/scripts/set_protection.py" "<file.docx>" --mode comments --out "<file-review.docx"
"<python>" "<skill>/scripts/set_protection.py" "<file.docx>" --mode readOnly --no_enforce --out "<file-open.docx"
```

Mode aliases: `off` / `none`, `readOnly` / `read_only`, `comments` / `comment`, `trackedChanges` / `tracked_changes`, `forms` / `form`. `--no_enforce` writes the setting without switching it on, which avoids the dialog on open.

`--hash` also writes a password hash (SHA-512, 100000 spins; `--salt` and `--spin_count` change the parameters). Say plainly that it deters casual edits, is not encryption, and that losing the password means stripping the restriction from the XML.

## Choose a mode

| Requirement | Mode |
|---|---|
| Comments only | `comments` |
| All edits tracked | `trackedChanges` |
| Fill a form | `forms` |
| View only | `readOnly` |

Remove the restriction with `--mode off --out "<file-open.docx"`.

## Verify

```bash
"<python>" "<skill>/scripts/docx_kit.py" xml '<file.docx>' word/settings.xml | grep documentProtection
```

The element and its enforcement setting appear in the output. Open behaviour is what matters, not the page: a render never shows a restriction. State the mode you applied and that removing it needs the same script or Word's Review pane.

## Pitfalls

- A protected document that also holds tracked changes or comments often prompts on open; apply the restriction last.
- `forms` without form fields leaves a document nobody can use.
- A hashed restriction cannot be turned off in Word without the password, yet `--mode off` clears it — which is why this is a guardrail, not security.
