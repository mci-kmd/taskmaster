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
})
