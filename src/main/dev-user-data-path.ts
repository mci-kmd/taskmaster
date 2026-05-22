import path from 'path'

export const DEV_USER_DATA_DIRECTORY_NAME = 'taskmaster-dev'

export function resolveDevUserDataPath(appDataPath: string, devMode: boolean): string | null {
  if (!devMode) {
    return null
  }

  const pathModule =
    /^[a-z]:[\\/]/iu.test(appDataPath) || appDataPath.startsWith('\\\\') ? path.win32 : path
  return pathModule.join(appDataPath, DEV_USER_DATA_DIRECTORY_NAME)
}
