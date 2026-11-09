import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  CONFIG_DIR,
  CONFIG_FILE,
  installerArguments,
  LEGACY_VENV_DIR,
  migrateLegacyVenv,
  RUNTIME_DIR,
  VENV_DIR,
} from '../postinstall.mjs'
import { officePaths } from '../src/python'

describe('installer arguments', () => {
  const args = installerArguments()

  it('appends PATH through the installer instead of prepending it', () => {
    expect(args).toContain('AppendPath=1')
    expect(args).not.toContain('PrependPath=0')
  })

  it('never sets TargetDir, so the installer keeps its per-user default', () => {
    expect(args.some(arg => arg.startsWith('TargetDir='))).toBe(false)
  })

  it('keeps the py launcher available', () => {
    expect(args).not.toContain('Include_launcher=0')
  })
})

describe('runtime layout', () => {
  it('places the venv under the active DSH home', () => {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    expect(RUNTIME_DIR).toBe(join(home, 'office', 'runtime'))
    expect(VENV_DIR).toBe(join(home, 'office', 'runtime', 'venv'))
  })

  it('keeps the legacy venv as a read-only fallback path', () => {
    expect(LEGACY_VENV_DIR).not.toBe(VENV_DIR)
    expect(LEGACY_VENV_DIR).toContain('dsh-office-kit')
  })

  it('moves an upgraded install off the legacy venv instead of reusing it', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-office-migrate-'))
    try {
      const legacy = join(root, 'legacy', 'venv')
      const target = join(root, 'runtime', 'venv')
      const interpreter = join(legacy, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
      mkdirSync(join(interpreter, '..'), { recursive: true })
      writeFileSync(interpreter, '')
      expect(migrateLegacyVenv(legacy, target)).toBe(true)
      expect(existsSync(interpreter.replace(legacy, target))).toBe(true)
      expect(existsSync(legacy)).toBe(false)
      expect(migrateLegacyVenv(legacy, target)).toBe(false)
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('config location', () => {
  it('writes config where the host half reads it', () => {
    // A platform mismatch here leaves a ready venv undiscoverable: the host half
    // reports missing-dependencies and every skill refuses to run.
    expect(join(CONFIG_DIR, 'config.json')).toBe(officePaths().configFile)
  })

  it('keeps everything the plugin owns under the active DSH home', () => {
    expect(CONFIG_DIR).toBe(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'office'))
    expect(CONFIG_FILE).toBe(join(CONFIG_DIR, 'config.json'))
    expect(VENV_DIR.startsWith(CONFIG_DIR)).toBe(true)
  })

  it('still reads the config older versions wrote', () => {
    const legacy = officePaths().legacyConfigFiles
    expect(legacy.length).toBeGreaterThan(0)
    for (const file of legacy) {
      expect(file).toContain('dsh-office-kit')
      expect(file).not.toBe(officePaths().configFile)
    }
  })
})
