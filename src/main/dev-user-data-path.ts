import { join } from 'path'

export const DEV_USER_DATA_DIRECTORY_NAME = 'taskmaster-dev'

export function resolveDevUserDataPath(appDataPath: string, devMode: boolean): string | null {
  if (!devMode) {
    return null
  }

  return join(appDataPath, DEV_USER_DATA_DIRECTORY_NAME)
}
