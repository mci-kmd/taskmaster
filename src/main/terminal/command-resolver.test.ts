import { mkdtemp, mkdir, writeFile, chmod, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, delimiter } from 'path'
import { setImmediate } from 'timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveCommandOnPathAsync } from './command-utils'

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile: mocks.execFile
}))

function windowsLookup(): Promise<string | null> {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32' })
  try {
    return resolveCommandOnPathAsync('copilot')
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
}

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

describe('asynchronous command lookup', () => {
  it('keeps the event loop responsive while Windows searches for the CLI', async () => {
    let finish!: (error: Error | null, stdout: string) => void
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
      finish = callback
    })
    let resolved = false
    const lookup = windowsLookup().then((result) => {
      resolved = true
      return result
    })
    await setImmediate()
    expect(resolved).toBe(false)
    expect(mocks.execFile).toHaveBeenCalledWith(
      'where.exe',
      ['copilot'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function)
    )
    finish(null, 'C:\\tools\\copilot\r\nC:\\tools\\copilot.cmd\r\n')
    expect(await lookup).toBe('C:\\tools\\copilot.cmd')
  })

  it('reports an unavailable CLI when the Windows search fails', async () => {
    mocks.execFile.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error('Not found'), '')
    )
    expect(await windowsLookup()).toBeNull()
  })

  it.runIf(process.platform !== 'win32')(
    'preserves PATH order and skips directories and non-executable files',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'taskmaster-path-'))
      try {
        const entries = ['directory', 'non-executable', 'first', 'second'].map((name) =>
          join(root, name)
        )
        for (const entry of entries) await mkdir(entry)
        const name = 'taskmaster-test-command'
        await mkdir(join(entries[0], name))
        for (const entry of entries.slice(1)) await writeFile(join(entry, name), '#!/bin/sh\n')
        for (const entry of entries.slice(2)) await chmod(join(entry, name), 0o755)
        vi.stubEnv('PATH', entries.join(delimiter))
        expect(await resolveCommandOnPathAsync(name)).toBe(join(entries[2], name))
        expect(await resolveCommandOnPathAsync(join(entries[1], name))).toBeNull()
        expect(await resolveCommandOnPathAsync(join(entries[2], name))).toBe(join(entries[2], name))
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
