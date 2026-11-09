import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'
import type { RuntimeStatus } from './python'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { OFFICE_FEATURES } from './features'
import { PACKAGE_ROOT, resolveKitCli } from './kit'
import { cliExists, ensureRuntime, officePaths, saveKitPath } from './python'

/** Services required by this host half. */
export const inject = ['skills', 'tools']

/** Cordis plugin identity used in loader diagnostics. */
export const name = 'dsh-office-kit'

const PROVIDER_NAME = 'dsh-office-kit'

interface ParsedSkill {
  readonly description: string
  readonly content: string
}

function parseSkill(raw: string, path: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (match?.[1] == null)
    throw new Error(`dsh-office-kit: ${path} has no YAML frontmatter`)
  const description = /^description:(.*)$/mu.exec(match[1])?.[1]?.trim()
  if (description == null || description.length === 0)
    throw new Error(`dsh-office-kit: ${path} has no description`)
  return {
    description: description.replace(/^["']|["']$/gu, ''),
    content: raw.slice(match[0].length).trim(),
  }
}

interface KitFacts {
  readonly available: boolean
  readonly node: string | null
  readonly cli: string | null
  readonly version: string | null
  readonly backend: string | null
  readonly error?: string
  readonly remedy?: string
}

const KIT_MISSING
  = 'the DSH LibreOffice kit (@deepseek-ai/libreoffice-kit) was not found: the plugin records where the harness loaded it from in dsh-office-kit\'s config.json, and DSH_LIBREOFFICE_KIT_CLI overrides that for a plugin running outside the harness'

const runKit = promisify(execFile)

async function kitFacts(): Promise<KitFacts> {
  const cli = resolveKitCli()
  if (cli == null)
    return { available: false, node: null, cli: null, version: null, backend: null, remedy: KIT_MISSING }
  const node = process.env.DSH_NODE ?? process.execPath
  try {
    const { stdout } = await runKit(node, [cli, 'capabilities', '--json'], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
    const parsed = JSON.parse(stdout) as { runtime?: { backend?: unknown, version?: unknown } }
    return {
      available: true,
      node,
      cli,
      version: typeof parsed.runtime?.version === 'string' ? parsed.runtime.version : null,
      backend: typeof parsed.runtime?.backend === 'string' ? parsed.runtime.backend : null,
    }
  }
  catch (error) {
    return {
      available: true,
      node,
      cli,
      version: null,
      backend: null,
      error: error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error),
    }
  }
}

function pluginVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  }
  catch {
    return 'unknown'
  }
}

/** Human-readable reason for a runtime that failed verification. */
function runtimeReason(runtime: RuntimeStatus): string {
  if (runtime.state === 'missing-dependencies') {
    const names = runtime.missing.map(entry => entry.package).join(', ')
    return `Python ${runtime.python?.version ?? ''} is installed but missing packages: ${names}`.replace('  ', ' ')
  }
  return 'no compatible Python 3.10–3.13 interpreter was found'
}

/** Register the four skills and a status tool, and expose the runtime paths in skill bodies. */
export function apply(ctx: Context): void {
  const paths = officePaths()
  const candidates: SkillCandidate[] = []

  // Agent shells get a curated environment, so an env var set here would not reach
  // them. Record the path instead: python/office_cli.py reads it from config.json.
  const kitCli = resolveKitCli()
  if (kitCli != null)
    saveKitPath(paths.configFile, process.execPath, kitCli)

  for (const feature of OFFICE_FEATURES) {
    const directory = join(paths.skillsDir, feature.skill)
    const path = join(directory, 'SKILL.md')
    if (!existsSync(path)) {
      // Registration must not fail the whole plugin because one pack is missing.
      console.warn(`[dsh-office-kit] missing skill file: ${path}`)
      continue
    }
    const candidate: SkillCandidate = {
      name: feature.skill,
      description: feature.description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: PROVIDER_NAME,
      source: 'bundled',
      rank: BUNDLED_SKILL_RANK,
      resourceBase: { kind: 'directory', path: directory.split('\\').join('/') },
      locator: path,
      path,
    }
    candidates.push(candidate)
  }

  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    list: () => Promise.resolve(candidates),
    async get(candidate: SkillCandidate, options): Promise<SkillDefinition | undefined> {
      if (!candidates.includes(candidate))
        return undefined
      const path = String(candidate.locator)
      let raw: string
      try {
        raw = await readFile(path, { encoding: 'utf8', signal: options.signal })
      }
      catch {
        return undefined
      }
      const parsed = parseSkill(raw, path)
      const runtime = await ensureRuntime(paths.configFile)
      const kitCli = resolveKitCli()
      const pythonLine = runtime.state === 'ok' && runtime.python != null
        ? `\n\n## Office runtime\n\nVerified absolute paths. Use them for every helper command; quote paths that contain spaces.\n\n- \`python\` runs all helper scripts, \`cli\` is the Office helper CLI.\n- \`skill\` is this skill's directory: its scripts live under \`<skill>/scripts/\`.\n- \`shared\` holds the cross-format notes and shared scripts.\n- \`renderer\` is the DSH LibreOffice kit; the helper finds it itself, so never pass it.\n\n\`\`\`json\n${JSON.stringify({ python: runtime.python.path, cli: paths.cli, skill: dirname(path).split('\\').join('/'), shared: join(paths.skillsDir, 'shared').split('\\').join('/'), version: runtime.python.version, ...(kitCli == null ? {} : { renderer: { kind: 'libreoffice-kit', cli: kitCli } }) }, null, 2)}\n\`\`\``
        : `\n\n## Office runtime\n\nNo working Python runtime is available: ${runtimeReason(runtime)}. Do not run helper commands or claim success. Tell the user: ${runtime.remedy} Then call \`office_status\` again.`
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return {
        ...summary,
        description: parsed.description,
        content: parsed.content + pythonLine,
      }
    },
  }

  ctx.effect(() => ctx.skills.registerProvider(() => provider), 'office-suite: skills')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'office_status',
    description: 'Report the Office runtime state: compatible Python, installed Python packages, helper CLI path, and document renderers (the DSH LibreOffice kit). Call this before Office file work.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 600_000,
    async execute() {
      // An explicit status check must never report a cached runtime that has since disappeared.
      const runtime = await ensureRuntime(paths.configFile, true)
      const report = {
        plugin: { name, version: pluginVersion() },
        runtime: {
          state: runtime.state,
          venv: paths.venv,
          ...(runtime.state === 'ok' ? {} : { reason: runtimeReason(runtime), remedy: runtime.remedy }),
          ...(runtime.error == null ? {} : { error: runtime.error }),
          ...(runtime.heal == null ? {} : { heal: runtime.heal }),
        },
        python: runtime.python == null
          ? { found: false }
          : {
              found: true,
              path: runtime.python.path,
              version: runtime.python.version,
              compatible: runtime.python.compatible,
              ...(runtime.python.error == null ? {} : { error: runtime.python.error }),
            },
        cli: { path: paths.cli, exists: cliExists() },
        config: { path: paths.configFile, exists: existsSync(paths.configFile) },
        packages: runtime.packages,
        renderers: await kitFacts(),
        skills: candidates.map(candidate => candidate.name),
      }
      return JSON.stringify(report, null, 2)
    },
  })), 'office-suite: status tool')
}
