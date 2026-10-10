import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { CopilotSdkManager, runNpmInstall } from './copilot-sdk-manager'

const values = vi.hoisted(() => ({
  /** The utility processes forked by the test, newest last. */
  children: [] as Array<
    import('events').EventEmitter & {
      postMessage: ReturnType<typeof vi.fn>
      kill: ReturnType<typeof vi.fn>
    }
  >,
  resourcesPath:
    process.platform === 'win32'
      ? 'C:\\Program Files\\taskmaster\\resources'
      : '/opt/taskmaster/resources'
}))

vi.mock('electron', () => ({
  utilityProcess: {
    fork: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() })
      values.children.push(child)
      return child
    })
  },
  app: {
    isPackaged: true,
    getAppPath: () =>
      process.platform === 'win32'
        ? `${values.resourcesPath}\\app.asar`
        : `${values.resourcesPath}/app.asar`,
    getPath: () =>
      process.platform === 'win32'
        ? `${values.resourcesPath}\\user-data`
        : `${values.resourcesPath}/user-data`
  }
}))

describe('CopilotSdkManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('points the packaged SDK at the unpacked native runtime', async () => {
    const loaded = await new CopilotSdkManager().loadSdk()
    const report = process.report?.getReport() as
      { header?: { glibcVersionRuntime?: unknown } } | undefined
    const platform =
      process.platform === 'linux'
        ? `${report?.header?.glibcVersionRuntime === undefined ? 'linuxmusl' : 'linux'}-${process.arch}`
        : `${process.platform}-${process.arch}`

    expect(loaded.runtimePath).toBe(
      join(
        values.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@github',
        `copilot-sdk-${platform}`,
        'prebuilds',
        platform,
        process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime'
      )
    )
  })

  it('checks for updates on start and then once per day', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => Response.json({ version: '1.0.0' }))
    vi.stubGlobal('fetch', fetchMock)
    const manager = new CopilotSdkManager()
    try {
      manager.startUpdateChecks()
      manager.startUpdateChecks()
      await vi.waitFor(async () => expect((await manager.getStatus()).latestVersion).toBe('1.0.0'))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      manager.stopUpdateChecks()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      manager.stopUpdateChecks()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

describe('runNpmInstall', () => {
  it('installs in a utility process and resolves when it reports success', async () => {
    const install = runNpmInstall('/sdks/1.2.3', '1.2.3')
    const child = values.children.at(-1)!
    child.emit('spawn')
    expect(child.postMessage).toHaveBeenCalledWith({
      targetDirectory: '/sdks/1.2.3',
      version: '1.2.3'
    })

    child.emit('message', { ok: true })
    await expect(install).resolves.toBeUndefined()
    expect(child.kill).toHaveBeenCalled()
  })

  it('rejects with the reported error or when the process exits without answering', async () => {
    const failed = runNpmInstall('/sdks/1.2.3', '1.2.3')
    values.children.at(-1)!.emit('message', { ok: false, error: 'ETARGET' })
    await expect(failed).rejects.toThrow('ETARGET')

    const crashed = runNpmInstall('/sdks/1.2.3', '1.2.3')
    values.children.at(-1)!.emit('exit', 1)
    await expect(crashed).rejects.toThrow('stopped unexpectedly')
  })
})

describe('runtimePlatform', () => {
  it.runIf(process.platform === 'linux')('detects the C library once', async () => {
    vi.resetModules()
    const { runtimePlatform } = await import('./copilot-sdk-manager')
    const getReport = vi.spyOn(process.report!, 'getReport')
    try {
      const platform = runtimePlatform()
      expect(platform).toMatch(/^linux(musl)?-/)
      expect(runtimePlatform()).toBe(platform)
      expect(getReport).toHaveBeenCalledTimes(1)
    } finally {
      getReport.mockRestore()
    }
  })
})
