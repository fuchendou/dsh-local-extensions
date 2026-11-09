#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * dsh-office-kit runtime bootstrap.
 *
 * Ensures a compatible Python (3.10–3.13) with the Office helper libraries is
 * available. The virtual environment lives in `~/.dsh/office/runtime/venv` on
 * every platform. On Windows a missing Python is downloaded from python.org,
 * signature-checked and installed silently into the installer's own per-user
 * location (AppendPath=1, no TargetDir, no manual registry edits).
 *
 * Run this script explicitly when preparing a development runtime. The host
 * reports missing dependencies without invoking this installer automatically.
 * The script is idempotent: a venv that already imports every dependency
 * returns immediately. PATH is maintained by the Python installer, never here.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const IS_WINDOWS = process.platform === 'win32'
const PYTHON_VERSION = '3.12.10'
export const RUNTIME_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'office', 'runtime')
export const VENV_DIR = join(RUNTIME_DIR, 'venv')
const VENV_PYTHON = join(VENV_DIR, IS_WINDOWS ? 'Scripts/python.exe' : 'bin/python')
const LEGACY_DATA_DIR = IS_WINDOWS
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'dsh-office-kit')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'dsh-office-kit')
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'dsh-office-kit')
export const LEGACY_VENV_DIR = join(LEGACY_DATA_DIR, 'venv')
const LEGACY_VENV_PYTHON = join(LEGACY_VENV_DIR, IS_WINDOWS ? 'Scripts/python.exe' : 'bin/python')
// Must mirror `officePaths()` in src/python.ts: the host half reads this file on
// every runtime probe, so a mismatch here makes a ready venv look missing.
export const CONFIG_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'office')
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
/**
 * Config files older versions wrote in the OS config directory. Read as
 * fallbacks so an upgraded install is not rebuilt or mis-reported.
 */
const LEGACY_CONFIG_FILES = [...new Set([
  IS_WINDOWS
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'dsh-office-kit', 'config.json')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'dsh-office-kit', 'config.json')
      : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'dsh-office-kit', 'config.json'),
  join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'dsh-office-kit', 'config.json'),
])]
const REQUIREMENTS = join(PACKAGE_ROOT, 'python', 'requirements.txt')
const LOG_PREFIX = '[dsh-office-kit]'

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`)
}

function warn(message) {
  console.warn(`${LOG_PREFIX} ${message}`)
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: false })
  return result.status === 0
}

function pythonInfo(executable, prefixArgs = []) {
  const script = 'import json,sys;print(json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable,"prefix":sys.prefix}))'
  const result = spawnSync(executable, [...prefixArgs, '-c', script], { encoding: 'utf8', timeout: 20000 })
  if (result.status !== 0) {
    return null
  }
  try {
    const info = JSON.parse(result.stdout.trim())
    const [major, minor] = info.version
    if (major !== 3 || minor < 10 || minor > 13) {
      return null
    }
    return info
  }
  catch {
    return null
  }
}

function listedInterpreters() {
  if (!IS_WINDOWS) {
    return []
  }
  try {
    const result = spawnSync('py', ['-0p'], { encoding: 'utf8', timeout: 30000 })
    if (result.status !== 0 || !result.stdout) {
      return []
    }
    return String(result.stdout).split(/\r?\n/u).flatMap((line) => {
      const match = /^\s*-V:\S+\s+([A-Z]:\\[^\r\n]*python\.exe)\s*$/iu.exec(line)
      return match?.[1] ? [match[1]] : []
    })
  }
  catch {
    return []
  }
}

function findCompatiblePython() {
  if (process.env.DSH_OFFICE_PYTHON) {
    const info = pythonInfo(process.env.DSH_OFFICE_PYTHON)
    if (info) {
      return { executable: process.env.DSH_OFFICE_PYTHON, args: [], info }
    }
    warn(`DSH_OFFICE_PYTHON is not a compatible Python 3.10–3.13: ${process.env.DSH_OFFICE_PYTHON}`)
  }

  const candidates = []
  if (IS_WINDOWS) {
    for (const version of ['3.13', '3.12', '3.11', '3.10']) {
      candidates.push({ executable: 'py', args: [`-${version}`] })
    }
    candidates.push({ executable: 'py', args: ['-3'] })
    for (const version of ['313', '312', '311', '310']) {
      candidates.push({ executable: join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', `Python${version}`, 'python.exe'), args: [] })
    }
    for (const executable of listedInterpreters()) {
      candidates.push({ executable, args: [] })
    }
  }
  candidates.push({ executable: 'python3', args: [] }, { executable: 'python', args: [] })

  for (const candidate of candidates) {
    if (!candidate.executable || (candidate.args.length === 0 && !existsSync(candidate.executable) && !commandExists(candidate.executable))) {
      continue
    }
    const info = pythonInfo(candidate.executable, candidate.args)
    if (info) {
      return { executable: candidate.executable, args: candidate.args, info }
    }
  }

  // A ready virtual environment still works even if its base interpreter was removed.
  for (const venvPython of [VENV_PYTHON, LEGACY_VENV_PYTHON]) {
    if (existsSync(venvPython)) {
      const info = pythonInfo(venvPython)
      if (info) {
        return { executable: venvPython, args: [], info }
      }
    }
  }
  return null
}

/** The first existing virtual environment that still runs, new layout first. */
function workingVenv() {
  for (const [python, directory] of [[VENV_PYTHON, VENV_DIR], [LEGACY_VENV_PYTHON, LEGACY_VENV_DIR]]) {
    if (!existsSync(python)) {
      continue
    }
    const info = pythonInfo(python)
    if (info) {
      return { python, directory, info }
    }
  }
  return null
}

function download(url, target) {
  log(`downloading ${url}`)
  const script = 'Invoke-WebRequest -UseBasicParsing -Uri $env:DSH_URL -OutFile $env:DSH_TARGET'
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit',
    env: { ...process.env, DSH_URL: url, DSH_TARGET: target },
    timeout: 15 * 60 * 1000,
  })
  if (result.status !== 0 || !existsSync(target)) {
    throw new Error(`download failed with status ${result.status}`)
  }
}

function verifySignature(file) {
  const script = [
    '$sig = Get-AuthenticodeSignature -FilePath $env:DSH_FILE',
    'if ($sig.Status -ne "Valid") { Write-Output "status=$($sig.Status)"; exit 1 }',
    'if ($sig.SignerCertificate.Subject -notmatch "Python Software Foundation") { Write-Output "signer=$($sig.SignerCertificate.Subject)"; exit 2 }',
    'Write-Output "valid"',
  ].join('; ')
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, DSH_FILE: file },
    timeout: 60000,
  })
  if (result.status !== 0) {
    throw new Error(`Python installer signature verification failed: ${(result.stdout || result.stderr || '').trim()}`)
  }
}

/**
 * Installer switches. PATH is appended by the installer itself (`AppendPath=1`),
 * the install location stays the per-user default (no `TargetDir`), and the
 * `py` launcher is kept so `py -3.12` works.
 */
export function installerArguments() {
  return [
    '/quiet',
    'InstallAllUsers=0',
    'AppendPath=1',
    'CompileAll=0',
    'Include_test=0',
    'Include_doc=0',
    'Include_pip=1',
    'SimpleInstall=1',
  ]
}

function installPython() {
  if (!IS_WINDOWS) {
    return false
  }
  // Unique per process: a stale installer from an interrupted run must not lock this download.
  const installer = join(tmpdir(), `python-${PYTHON_VERSION}-amd64-${process.pid}-${Date.now()}.exe`)
  const url = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`
  download(url, installer)
  verifySignature(installer)
  log(`installing Python ${PYTHON_VERSION} into the installer default per-user location`)
  const result = spawnSync(installer, installerArguments(), { stdio: 'inherit', timeout: 15 * 60 * 1000 })
  rmSync(installer, { force: true })
  if (result.status !== 0) {
    throw new Error(`Python installer exited with status ${result.status}`)
  }
  return true
}

/**
 * Move an upgraded install's venv out of the pre-0.4 data directory.
 *
 * Reusing the legacy venv in place kept the old layout alive forever, so the
 * canonical path was only ever reached by fresh installs. A rename is instant
 * and offline; if it fails (another volume, a locked interpreter) the legacy
 * venv stays usable and the next install retries.
 */
export function migrateLegacyVenv(legacy = LEGACY_VENV_DIR, target = VENV_DIR) {
  const interpreter = venvPythonIn(legacy)
  if (existsSync(target) || !existsSync(interpreter)) {
    return false
  }
  try {
    mkdirSync(dirname(target), { recursive: true })
    renameSync(legacy, target)
    log(`moved the virtual environment from ${legacy} to ${target}`)
    return true
  }
  catch (error) {
    warn(`could not move the legacy virtual environment: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

function venvPythonIn(directory) {
  return join(directory, IS_WINDOWS ? 'Scripts/python.exe' : 'bin/python')
}

function ensureVenv(base) {
  migrateLegacyVenv()
  const existing = workingVenv()
  if (existing) {
    if (existing.directory === LEGACY_VENV_DIR) {
      log(`using the existing virtual environment at ${LEGACY_VENV_DIR} (legacy layout)`)
    }
    return existing.python
  }
  if (existsSync(VENV_DIR)) {
    warn(`replacing incomplete virtual environment at ${VENV_DIR}`)
    rmSync(VENV_DIR, { recursive: true, force: true })
  }
  mkdirSync(dirname(VENV_DIR), { recursive: true })
  log(`creating virtual environment at ${VENV_DIR}`)
  const result = spawnSync(base.executable, [...base.args, '-m', 'venv', VENV_DIR], { stdio: 'inherit', timeout: 300000 })
  if (result.status !== 0 || !existsSync(VENV_PYTHON)) {
    throw new Error(`could not create virtual environment (status ${result.status})`)
  }
  const info = pythonInfo(VENV_PYTHON)
  if (!info) {
    throw new Error('virtual environment interpreter is not executable')
  }
  return VENV_PYTHON
}

function installRequirements(python) {
  if (!existsSync(REQUIREMENTS)) {
    throw new Error(`requirements file missing: ${REQUIREMENTS}`)
  }
  log('installing Python packages (this may take a few minutes)')
  const result = spawnSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--upgrade', '-r', REQUIREMENTS], {
    stdio: 'inherit',
    timeout: 30 * 60 * 1000,
  })
  if (result.status !== 0) {
    throw new Error(`pip install exited with status ${result.status}`)
  }
}

function verifyImports(python) {
  const modules = ['docx', 'openpyxl', 'pptx', 'pypdf', 'reportlab', 'pdfplumber', 'pymupdf', 'PIL', 'latex2mathml', 'mathml2omml']
  const script = `import importlib, json\nmissing = []\nfor name in ${JSON.stringify(modules)}:\n    try:\n        importlib.import_module(name)\n    except Exception as exc:\n        missing.append({"module": name, "error": f"{type(exc).__name__}: {exc}"})\nprint(json.dumps({"ok": not missing, "missing": missing}))`
  const result = spawnSync(python, ['-c', script], { encoding: 'utf8', timeout: 120000 })
  if (result.status !== 0) {
    throw new Error(`import verification failed: ${(result.stderr || '').trim()}`)
  }
  const report = JSON.parse(result.stdout.trim())
  if (!report.ok) {
    throw new Error(`missing Python modules: ${JSON.stringify(report.missing)}`)
  }
  return report
}

function readConfig() {
  // Oldest first so the canonical file and the newest legacy record win key by key.
  const merged = {}
  for (const file of [...LEGACY_CONFIG_FILES].reverse().concat(CONFIG_FILE)) {
    if (!existsSync(file)) {
      continue
    }
    try {
      Object.assign(merged, JSON.parse(readFileSync(file, 'utf8')))
    }
    catch {
      // A malformed file must not hide a usable one.
    }
  }
  return merged
}

function writeConfig(config) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true })
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function writeReadyConfig(existingConfig, python, basePython, report) {
  const info = pythonInfo(python)
  writeConfig({
    ...existingConfig,
    python,
    ...(basePython ? { basePython } : {}),
    ...(info ? { pythonVersion: info.version.join('.') } : {}),
    pluginVersion: readPackageVersion(),
    updatedAt: new Date().toISOString(),
    imports: report,
  })
  // The canonical file now holds everything the legacy files had; a pre-0.5 file
  // that stays behind only makes "where is the config" ambiguous.
  for (const file of LEGACY_CONFIG_FILES) {
    try {
      rmSync(file, { force: true })
    }
    catch {}
  }
}

function main() {
  if (process.env.DSH_OFFICE_SKIP_POSTINSTALL === '1') {
    log('skipped by DSH_OFFICE_SKIP_POSTINSTALL=1')
    return
  }
  if (process.env.CI && process.env.DSH_OFFICE_POSTINSTALL !== '1') {
    log('CI detected; skipping the Python environment setup. Set DSH_OFFICE_POSTINSTALL=1 to force it.')
    return
  }

  const existingConfig = readConfig()

  // Fast path: an installed venv that already imports everything needs no network and no pip.
  const ready = workingVenv()
  if (ready) {
    try {
      const report = verifyImports(ready.python)
      writeReadyConfig(existingConfig, ready.python, existingConfig.basePython, report)
      log('Python environment is ready.')
      log(`interpreter: ${ready.python}`)
      return
    }
    catch (error) {
      warn(`existing virtual environment needs repair: ${error.message}`)
    }
  }

  let base = findCompatiblePython()
  if (!base) {
    if (!IS_WINDOWS) {
      warn('no compatible Python 3.10–3.13 was found. Install one and rerun `node postinstall.mjs`.')
      process.exitCode = 1
      return
    }
    try {
      installPython()
    }
    catch (error) {
      warn(`automatic Python installation failed: ${error.message}`)
      warn('The plugin will report the missing runtime instead of pretending to work.')
      process.exitCode = 1
      return
    }
    base = findCompatiblePython()
    if (!base) {
      warn('the Python installer finished but no compatible interpreter was found in the default per-user location.')
      process.exitCode = 1
      return
    }
  }

  log(`using Python ${base.info.version.join('.')} at ${base.info.executable}`)
  try {
    const python = ensureVenv(base)
    installRequirements(python)
    const report = verifyImports(python)
    writeReadyConfig(existingConfig, python, base.info.executable, report)
    log('Python environment is ready.')
    log(`interpreter: ${python}`)
  }
  catch (error) {
    warn(`Python environment setup failed: ${error.message}`)
    warn('The plugin will report the missing runtime instead of pretending to work.')
    process.exitCode = 1
  }
}

function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version
  }
  catch {
    return 'unknown'
  }
}

function startedFromCli() {
  const entry = process.argv[1]
  if (entry == null) {
    return false
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  }
  catch {
    return false
  }
}

if (startedFromCli()) {
  const started = Date.now()
  main()
  log(`finished in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}
