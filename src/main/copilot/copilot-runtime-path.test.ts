import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { resolvePackagedCopilotRuntimePath } from './copilot-runtime-path'

describe('resolvePackagedCopilotRuntimePath', () => {
  it('points packaged Windows apps at the unpacked SDK runtime', () => {
    const appPath = join('C:\\Apps', 'taskmaster', 'resources', 'app.asar')

    expect(resolvePackagedCopilotRuntimePath(appPath, 'win32', 'x64')).toBe(
      join(
        `${appPath}.unpacked`,
        'node_modules',
        '@github',
        'copilot-sdk-win32-x64',
        'prebuilds',
        'win32-x64',
        'copilot-runtime.exe'
      )
    )
  })

  it('uses normal SDK resolution outside an asar archive', () => {
    expect(resolvePackagedCopilotRuntimePath('C:\\Code\\taskmaster', 'win32', 'x64')).toBeNull()
  })

  it('selects the musl runtime package on Linux when requested', () => {
    const appPath = '/opt/taskmaster/resources/app.asar'

    expect(resolvePackagedCopilotRuntimePath(appPath, 'linux', 'arm64', true)).toBe(
      join(
        `${appPath}.unpacked`,
        'node_modules',
        '@github',
        'copilot-sdk-linuxmusl-arm64',
        'prebuilds',
        'linuxmusl-arm64',
        'copilot-runtime'
      )
    )
  })
})
