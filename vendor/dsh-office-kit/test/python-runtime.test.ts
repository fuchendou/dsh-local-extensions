import type { PythonInspection, RuntimeStatus } from '../src/python'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  ensureRuntime,
  officePaths,
  runtimeAlive,
  runtimeRemedy,
  selectRuntime,
  venvPython,
} from '../src/python'

function inspection(overrides: Partial<PythonInspection> = {}): PythonInspection {
  return {
    path: 'C:/python/python.exe',
    version: '3.13.0',
    major: 3,
    minor: 13,
    compatible: true,
    packages: [],
    missing: [],
    ...overrides,
  }
}

const missingDep = { package: 'python-docx', importName: 'docx', installed: false }

function status(python: RuntimeStatus['python']): RuntimeStatus {
  return {
    state: 'ok',
    python,
    packages: [],
    missing: [],
    remedy: 'node postinstall.mjs',
  }
}

describe('runtimeAlive', () => {
  it('reports a missing runtime without installing or creating a venv', async () => {
    const root = mkdtempSync(join(tmpdir(), 'office-no-install-'))
    const previous = { home: process.env.HOME, dsh: process.env.DSH_HOME, python: process.env.DSH_OFFICE_PYTHON, path: process.env.PATH }
    process.env.HOME = root
    process.env.DSH_HOME = root
    process.env.DSH_OFFICE_PYTHON = join(root, 'missing-python')
    process.env.PATH = join(root, 'no-path')
    try {
      const result = await ensureRuntime(join(root, 'config.json'), true)
      expect(result.state).toBe('no-interpreter')
      expect(result.heal?.attempted).not.toBe(true)
      expect(existsSync(join(root, 'office', 'runtime', 'venv'))).toBe(false)
    }
    finally {
      for (const [key, value] of Object.entries({ HOME: previous.home, DSH_HOME: previous.dsh, DSH_OFFICE_PYTHON: previous.python, PATH: previous.path })) {
        if (value === undefined)
          delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('keeps a cached runtime while its interpreter exists', () => {
    expect(runtimeAlive(status(inspection({ path: process.execPath })))).toBe(true)
  })

  it('rejects a cached runtime whose interpreter vanished', () => {
    expect(runtimeAlive(status(inspection({ path: 'C:/no/such/venv/Scripts/python.exe' })))).toBe(false)
  })

  it('does not treat a failed state as a stale interpreter', () => {
    expect(runtimeAlive({ state: 'no-interpreter', packages: [], missing: [], remedy: 'x' })).toBe(true)
  })
})

describe('selectRuntime', () => {
  it('reports ok only for an interpreter that imports every dependency', () => {
    const result = selectRuntime([inspection({ path: 'C:/venv/python.exe' })])
    expect(result.state).toBe('ok')
    expect(result.python?.path).toBe('C:/venv/python.exe')
    expect(result.remedy).toBe(runtimeRemedy())
  })

  it('never accepts a version-compatible but dependency-free interpreter as ok', () => {
    const result = selectRuntime([inspection({ missing: [missingDep] })])
    expect(result.state).toBe('missing-dependencies')
    expect(result.missing).toHaveLength(1)
  })

  it('skips a broken interpreter and uses a later fully-provisioned one', () => {
    const result = selectRuntime([
      inspection({ path: 'C:/system/python.exe', missing: [missingDep] }),
      inspection({ path: 'C:/venv/python.exe' }),
    ])
    expect(result.state).toBe('ok')
    expect(result.python?.path).toBe('C:/venv/python.exe')
  })

  it('reports no-interpreter when nothing is compatible', () => {
    const result = selectRuntime([inspection({ compatible: false, minor: 14 })])
    expect(result.state).toBe('no-interpreter')
    expect(result.python).toBeUndefined()
  })

  it('surfaces the last probe error when no interpreter exists', () => {
    const result = selectRuntime([inspection({ compatible: false, error: 'spawn ENOENT' })])
    expect(result.state).toBe('no-interpreter')
    expect(result.error).toBe('spawn ENOENT')
  })
})

describe('paths and remedy', () => {
  it('keeps the runtime under the active DSH_HOME', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = join(homedir(), 'isolated-dsh-home')
    try {
      expect(officePaths().venv).toBe(join(process.env.DSH_HOME, 'office', 'runtime', 'venv'))
    }
    finally {
      if (previous === undefined)
        delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('puts the venv under the active DSH home', () => {
    const paths = officePaths()
    expect(paths.venv).toBe(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'office', 'runtime', 'venv'))
  })

  it('keeps the legacy venv separate from the new layout', () => {
    const paths = officePaths()
    expect(paths.legacyVenv).not.toBe(paths.venv)
    expect(paths.legacyVenv).toContain('dsh-office-kit')
  })

  it('points to the controlled deployment procedure when dependencies are missing', () => {
    expect(runtimeRemedy()).toContain('部署文档')
    expect(runtimeRemedy()).not.toContain('postinstall')
  })

  it('resolves the interpreter inside a venv, not the venv directory', () => {
    // Probing the directory fails with EACCES and silently demotes the runtime to a
    // bare system interpreter, so the candidate must name the executable.
    const paths = officePaths()
    const python = venvPython(paths.venv)
    expect(python).not.toBe(paths.venv)
    expect(python.startsWith(paths.venv)).toBe(true)
    // Build the expectation with join: on Windows the separator is a backslash, so a
    // literal 'Scripts/python.exe' never matches the joined path.
    expect(python.endsWith(join('Scripts', 'python.exe')) || python.endsWith(join('bin', 'python'))).toBe(true)
  })
})
