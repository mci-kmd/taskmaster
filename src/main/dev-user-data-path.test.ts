import { describe, expect, it } from 'vitest'
import { DEV_USER_DATA_DIRECTORY_NAME, resolveDevUserDataPath } from './dev-user-data-path'

describe('resolveDevUserDataPath', () => {
  it('returns null outside dev mode', () => {
    expect(resolveDevUserDataPath('C:\\Users\\me\\AppData\\Roaming', false)).toBeNull()
  })

  it('uses taskmaster-dev inside appData when in dev mode', () => {
    expect(resolveDevUserDataPath('C:\\Users\\me\\AppData\\Roaming', true)).toBe(
      `C:\\Users\\me\\AppData\\Roaming\\${DEV_USER_DATA_DIRECTORY_NAME}`
    )
  })
})
