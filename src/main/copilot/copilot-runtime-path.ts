import { join } from 'path'

type RuntimePlatform = NodeJS.Platform
type RuntimeArch = NodeJS.Architecture

function getRuntimePlatform(
  platform: RuntimePlatform,
  arch: RuntimeArch,
  linuxUsesMusl: boolean
): string {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported Copilot runtime architecture: ${arch}.`)
  }

  if (platform === 'linux') {
    return `${linuxUsesMusl ? 'linuxmusl' : 'linux'}-${arch}`
  }
  if (platform === 'darwin' || platform === 'win32') {
    return `${platform}-${arch}`
  }

  throw new Error(`Unsupported Copilot runtime platform: ${platform}-${arch}.`)
}

export function resolvePackagedCopilotRuntimePath(
  appPath: string,
  platform: RuntimePlatform = process.platform,
  arch: RuntimeArch = process.arch,
  linuxUsesMusl = false
): string | null {
  if (!appPath.toLowerCase().endsWith('.asar')) {
    return null
  }

  const runtimePlatform = getRuntimePlatform(platform, arch, linuxUsesMusl)
  const executable = platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime'
  return join(
    `${appPath}.unpacked`,
    'node_modules',
    '@github',
    `copilot-sdk-${runtimePlatform}`,
    'prebuilds',
    runtimePlatform,
    executable
  )
}
