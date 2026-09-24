import { describe, expect, it } from 'vitest'
import { threadMenuActions } from './sidebar-thread-actions'

describe('thread menu actions', () => {
  it('preserves project thread close and conversion availability', () => {
    const options = {
      convertToWorktreeVisible: true,
      convertToWorktreeEnabled: false,
      closeThreadEnabled: false
    }
    expect(threadMenuActions(options)).toEqual([
      { action: 'edit', label: 'Edit', enabled: true },
      { action: 'convert-to-worktree', label: 'Converting...', enabled: false },
      { action: 'close-thread', label: 'Closing...', enabled: false }
    ])
    expect(
      threadMenuActions({
        ...options,
        convertToWorktreeEnabled: true,
        closeThreadEnabled: true
      })
    ).toEqual([
      { action: 'edit', label: 'Edit', enabled: true },
      { action: 'convert-to-worktree', label: 'Convert to work tree', enabled: true },
      { action: 'close-thread', label: 'Close thread', enabled: true }
    ])
  })
})
