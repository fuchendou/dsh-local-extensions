import type { ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Minimum interpreter minor version this plugin supports. */
export const MIN_PYTHON = 10
/** First unsupported interpreter minor version (wheel availability is the reason). */
export const MAX_PYTHON_EXCLUSIVE = 14
/** Python packages the helper CLI needs. */
export const PYTHON_PACKAGES = [
  { importName: 'docx', package: 'python-docx' },
  { importName: 'openpyxl', package: 'openpyxl' },
  { importName: 'pptx', package: 'python-pptx' },
  { importName: 'pypdf', package: 'pypdf' },
  { importName: 'reportlab', package: 'reportlab' },
  { importName: 'pdfplumber', package: 'pdfplumber' },
  { importName: 'pymupdf', package: 'pymupdf' },
  { importName: 'PIL', package: 'pillow' },
  { importName: 'latex2mathml', package: 'latex2mathml' },
  { importName: 'mathml2omml', package: 'mathml2omml' },
] as const

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
/** Failed probes are retried after this delay instead of re-running pip on every status call. */
const FAILURE_RETRY_DELAY = 5 * 60 * 1000

/** Absolute paths this plugin owns inside a user profile. */
export interface OfficePaths {
  readonly configFile: string
  readonly legacyConfigFiles: readonly string[]
  readonly venv: string
  readonly legacyVenv: string
  readonly cli: string
  readonly skillsDir: string
}

/** Where every version of this plugin keeps its runtime, next to DSH's own data. */
function officeHome(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'office')
}

function legacyDataDir(): string {
  const home = homedir()
  return process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'dsh-office-kit')
    : process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'dsh-office-kit')
      : join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'dsh-office-kit')
}

/**
 * Config files older versions wrote, newest first.
 *
 * The pre-0.5 config stayed in the OS config directory (`%APPDATA%\dsh-office-kit`,
 * `$XDG_CONFIG_HOME/dsh-office-kit`, `~/Library/Application Support/dsh-office-kit`).
 * Reading them keeps an upgraded install from rebuilding or mis-reporting its venv.
 */
function legacyConfigFiles(): string[] {
  const home = homedir()
  return [...new Set([
    process.platform === 'win32'
      ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'dsh-office-kit', 'config.json')
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support', 'dsh-office-kit', 'config.json')
        : join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'dsh-office-kit', 'config.json'),
    join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'dsh-office-kit', 'config.json'),
  ])]
}

/** Resolve per-OS config/data directories and bundled resources. */
export function officePaths(): OfficePaths {
  const runtimeDir = join(officeHome(), 'runtime')
  return {
    configFile: join(officeHome(), 'config.json'),
    legacyConfigFiles: legacyConfigFiles(),
    venv: join(runtimeDir, 'venv'),
    legacyVenv: join(legacyDataDir(), 'venv'),
    cli: join(PACKAGE_ROOT, 'python', 'office_cli.py'),
    skillsDir: join(PACKAGE_ROOT, 'assets', 'skills'),
  }
}

/** One required Python package as reported by the interpreter itself. */
export interface PackageState {
  readonly package: string
  readonly importName: string
  readonly installed: boolean
  readonly version?: string
  readonly error?: string
}

/** Result of inspecting one interpreter candidate. */
export interface PythonInspection {
  readonly path: string
  readonly version: string
  readonly major: number
  readonly minor: number
  readonly compatible: boolean
  readonly packages: readonly PackageState[]
  readonly missing: readonly PackageState[]
  readonly error?: string
}

/** Three-state runtime answer: ready, interpreter without dependencies, or nothing usable. */
export type RuntimeState = 'ok' | 'missing-dependencies' | 'no-interpreter'

/** Outcome of the last self-heal attempt. */
export interface RuntimeHeal {
  readonly attempted: boolean
  readonly error?: string
}

/** Everything the host half and the status tool need to know about the runtime. */
export interface RuntimeStatus {
  readonly state: RuntimeState
  readonly python?: PythonInspection
  readonly packages: readonly PackageState[]
  readonly missing: readonly PackageState[]
  readonly remedy: string
  readonly heal?: RuntimeHeal
  readonly error?: string
}

/** One-liner the user can run to repair the runtime without pnpm. */
export function runtimeRemedy(): string {
  return '按部署文档配置独立 Python 环境及锁定的办公依赖。'
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

function run(file: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = execFile(file, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }, (error, stdout) => {
      if (error != null) {
        reject(error)
        return
      }
      resolve(String(stdout).trim())
    })
    child.stdin?.end()
  })
}

const RUNTIME_SCRIPT = `
import importlib, json, sys
targets = ${JSON.stringify(PYTHON_PACKAGES)}
packages = {}
for item in targets:
    try:
        module = importlib.import_module(item["importName"])
        packages[item["package"]] = {"installed": True, "version": str(getattr(module, "__version__", ""))}
    except Exception as exc:
        packages[item["package"]] = {"installed": False, "error": f"{type(exc).__name__}: {exc}"}
print(json.dumps({"python": sys.executable, "version": sys.version.split()[0], "packages": packages}))
`.trim()

interface RuntimeProbePayload {
  readonly python?: unknown
  readonly version?: unknown
  readonly packages?: Record<string, { installed?: unknown, version?: unknown, error?: unknown }>
}

/** Inspect an absolute interpreter: version plus every required import. */
export function inspectPython(path: string): Promise<PythonInspection> {
  return run(path, ['-c', RUNTIME_SCRIPT], 60_000).then((raw) => {
    try {
      const parsed = JSON.parse(raw) as RuntimeProbePayload
      if (typeof parsed.version !== 'string' || typeof parsed.python !== 'string')
        throw new Error('unexpected interpreter response')
      const [majorText, minorText] = parsed.version.split('.')
      const major = Number(majorText)
      const minor = Number(minorText)
      const incompatible = major !== 3 || minor < MIN_PYTHON || minor >= MAX_PYTHON_EXCLUSIVE
      const packages: PackageState[] = PYTHON_PACKAGES.map(({ importName, package: name }) => {
        const entry = parsed.packages?.[name]
        const installed = entry?.installed === true
        return {
          package: name,
          importName,
          installed,
          ...(typeof entry?.version === 'string' && entry.version.length > 0 ? { version: entry.version } : {}),
          ...(typeof entry?.error === 'string' && entry.error.length > 0 ? { error: entry.error } : {}),
        }
      })
      const missing = packages.filter(entry => !entry.installed)
      const inspection: PythonInspection = {
        path: parsed.python,
        version: parsed.version,
        major,
        minor,
        compatible: !incompatible,
        packages,
        missing: incompatible ? [] : missing,
      }
      return incompatible
        ? { ...inspection, error: `unsupported Python ${parsed.version}` }
        : inspection
    }
    catch (error) {
      return failedInspection(path, error)
    }
  }, error => failedInspection(path, error))
}

function failedInspection(path: string, error: unknown): PythonInspection {
  return {
    path,
    version: '',
    major: 0,
    minor: 0,
    compatible: false,
    packages: [],
    missing: [],
    error: error instanceof Error ? error.message : String(error),
  }
}

interface SavedPython {
  readonly python?: unknown
  readonly version?: unknown
}

/**
 * Read the interpreter path postinstall recorded; malformed files are ignored.
 * The legacy locations are read after the canonical one so an upgrade does not
 * orphan a ready venv.
 */
function savedPython(configFile: string, legacyConfigFiles: readonly string[] = []): string | undefined {
  const files = [configFile, ...legacyConfigFiles]
  for (const file of files) {
    if (!isFile(file))
      continue
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as SavedPython
      if (typeof parsed.python === 'string' && parsed.python.length > 0)
        return parsed.python
    }
    catch {
      // Keep looking: one corrupt file must not hide a usable record.
    }
  }
  return undefined
}

/**
 * Read the plugin config, falling back to files older versions wrote.
 *
 * The canonical file wins key by key, so a legacy record contributes only what
 * the new file has not written yet (an upgrade usually still needs its venv).
 */
function loadConfig(configFile: string): Record<string, unknown> {
  const legacy = officePaths().legacyConfigFiles
  const merged: Record<string, unknown> = {}
  for (const file of [...legacy].reverse()) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed))
        Object.assign(merged, parsed as Record<string, unknown>)
    }
    catch {
      // Missing or corrupt legacy file: nothing to inherit.
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(configFile, 'utf8')) as unknown
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed))
      Object.assign(merged, parsed as Record<string, unknown>)
  }
  catch {
    // First run: the legacy values, or an empty record.
  }
  return merged
}

/**
 * Merge one key into the plugin's config without disturbing the rest.
 *
 * Versions that predate the current layout left stale absolute paths behind, so
 * the record is refreshed whenever the host resolves something different.
 */
function saveRecord(configFile: string, key: string, value: unknown): void {
  const config = loadConfig(configFile)
  if (JSON.stringify(config[key]) === JSON.stringify(value) && isFile(configFile))
    return
  const temporary = `${configFile}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(configFile), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify({ ...config, [key]: value }, null, 2)}\n`, 'utf8')
    renameSync(temporary, configFile)
  }
  catch {
    // A read-only config must not stop the plugin from loading.
  }
}

/**
 * Record the renderer the harness loaded so every later helper call finds it.
 *
 * A profile install keeps the plugin in `~/.dsh/profiles/<name>/node_modules`
 * and the kit in the harness tree, so no walk-up from the plugin can reach it.
 * The helper reads this record first; a read-only config must not stop loading.
 */
export function saveKitPath(configFile: string, node: string, cli: string): void {
  saveRecord(configFile, 'libreofficeKit', { node, cli })
}

/** Record the interpreter this plugin settled on so the next probe can trust it. */
export function savePythonPath(configFile: string, python: string): void {
  saveRecord(configFile, 'python', python)
}

/** The interpreter inside a virtual environment, which differs per platform. */
export function venvPython(venv: string): string {
  return join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
}

/** PATH-independent candidate list, plugin-owned interpreters first. */
function candidates(configFile: string): string[] {
  const paths = officePaths()
  const found: string[] = []
  const env = process.env.DSH_OFFICE_PYTHON
  if (env != null && env.length > 0)
    found.push(env)
  // The canonical venv outranks the recorded path: a record written before the
  // layout moved still names the legacy venv, which postinstall now migrates.
  found.push(venvPython(paths.venv))
  const saved = savedPython(configFile, paths.legacyConfigFiles)
  if (saved != null)
    found.push(saved)
  // The venv roots are directories; the probe must receive the interpreter inside
  // them. Pushing the directory made every plugin-owned candidate fail with EACCES
  // and silently demoted the runtime to a bare system interpreter.
  found.push(venvPython(paths.legacyVenv))
  for (const name of ['python3', 'python'])
    found.push(name)
  if (process.platform === 'win32') {
    for (const version of ['3.13', '3.12', '3.11', '3.10'])
      found.push(`py -${version}`)
    found.push('py -3')
  }
  return [...new Set(found)]
}

/** Resolve the launcher (`py -3.12`) into the absolute interpreter it runs. */
async function expandLauncher(candidate: string): Promise<string[]> {
  if (!candidate.startsWith('py '))
    return [candidate]
  const args = candidate.split(' ').slice(1)
  try {
    const raw = await run('py', [...args, '-c', 'import sys;print(sys.executable)'])
    return raw.length > 0 ? [raw] : []
  }
  catch {
    return []
  }
}

/** Interpreters the Windows `py` launcher reports, including tagged (non-numeric) installs. */
async function launcherInterpreters(): Promise<string[]> {
  if (process.platform !== 'win32')
    return []
  try {
    const raw = await run('py', ['-0p'])
    return raw.split(/\r?\n/u).flatMap((line) => {
      const match = /^\s*-V:\S+\s+([A-Z]:\\[^\r\n]*python\.exe)\s*$/iu.exec(line)
      return match?.[1] != null ? [match[1]] : []
    })
  }
  catch {
    return []
  }
}

function statusOf(python: PythonInspection): RuntimeStatus {
  const ready = python.compatible && python.missing.length === 0
  return {
    state: ready ? 'ok' : 'missing-dependencies',
    python,
    packages: python.packages,
    missing: python.missing,
    remedy: runtimeRemedy(),
  }
}

/** Pick the best interpreter: all dependencies first, then compatible-only, else none. */
export function selectRuntime(inspections: readonly PythonInspection[]): RuntimeStatus {
  const ready = inspections.find(inspection => inspection.compatible && inspection.missing.length === 0)
  if (ready != null)
    return statusOf(ready)
  const compatible = inspections.find(inspection => inspection.compatible)
  if (compatible != null)
    return statusOf(compatible)
  const last = inspections[inspections.length - 1]
  return {
    state: 'no-interpreter',
    packages: [],
    missing: [],
    remedy: runtimeRemedy(),
    ...(last?.error == null ? {} : { error: last.error }),
  }
}

/** Inspect candidates in priority order; the first fully-provisioned interpreter wins. */
export async function inspectRuntime(configFile = officePaths().configFile): Promise<RuntimeStatus> {
  const seen: PythonInspection[] = []
  for (const candidate of [...candidates(configFile), ...await launcherInterpreters()]) {
    for (const expanded of await expandLauncher(candidate)) {
      if (expanded !== candidate && !isFile(expanded))
        continue
      const inspection = await inspectPython(expanded)
      seen.push(inspection)
      if (inspection.compatible && inspection.missing.length === 0)
        return settledRuntime(seen, configFile)
    }
  }
  return settledRuntime(seen, configFile)
}

/**
 * Freeze the probe result and keep config.json honest about which interpreter won.
 *
 * A venv migrated out of the legacy data directory leaves the old absolute path
 * recorded; rewriting it stops the next launch from probing a dead path first.
 */
function settledRuntime(seen: PythonInspection[], configFile: string): RuntimeStatus {
  const status = selectRuntime(seen)
  if (status.state === 'ok' && status.python != null && status.python.path !== savedPython(configFile))
    savePythonPath(configFile, status.python.path)
  return status
}

interface RuntimeCache {
  readonly status: RuntimeStatus
  readonly at: number
}

let cache: RuntimeCache | undefined
let healing: Promise<RuntimeStatus> | undefined

/** A cached `ok` is only worth reusing while its interpreter still exists on disk. */
export function runtimeAlive(status: RuntimeStatus): boolean {
  return status.state !== 'ok' || (status.python != null && isFile(status.python.path))
}

/**
 * Resolve a runtime that is proven to work, without installing dependencies.
 * Pass `force` for an explicit status check that must not trust the process cache.
 */
export function ensureRuntime(configFile = officePaths().configFile, force = false): Promise<RuntimeStatus> {
  if (!force && cache != null) {
    const reusable = cache.status.state === 'ok' ? runtimeAlive(cache.status) : Date.now() - cache.at < FAILURE_RETRY_DELAY
    if (reusable)
      return Promise.resolve(cache.status)
  }
  healing ??= (async (): Promise<RuntimeStatus> => {
    const status = await inspectRuntime(configFile)
    cache = { status, at: Date.now() }
    return status
  })().finally(() => {
    healing = undefined
  })
  return healing
}

/** Whether the helper CLI file shipped with this package. */
export function cliExists(): boolean {
  return isFile(officePaths().cli)
}
