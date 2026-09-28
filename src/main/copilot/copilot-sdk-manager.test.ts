import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotSdkManager } from './copilot-sdk-manager'

const values = vi.hoisted(() => ({
  resourcesPath:
    process.platform === 'win32'
      ? 'C:\\Program Files\\taskmaster\\resources'
      : '/opt/taskmaster/resources'
}))

vi.mock('electron', () => ({
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
