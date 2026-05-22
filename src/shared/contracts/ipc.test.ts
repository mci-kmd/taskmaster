import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from './ipc'

function flattenChannels(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.values(value).flatMap(flattenChannels)
}

describe('IPC channel contracts', () => {
  it('keeps channel names unique', () => {
    const channels = flattenChannels(IPC_CHANNELS)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('uses explicit feature prefixes for all channels', () => {
    expect(flattenChannels(IPC_CHANNELS)).toEqual(
      expect.arrayContaining([
        'app-state:get-snapshot',
        'native-menu:show-sidebar-context-menu',
        'terminal:create'
      ])
    )
  })
})
