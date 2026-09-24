import { describe, expect, it } from 'vitest'
import { threadMenuActions } from './sidebar-thread-actions'

describe('thread menu actions', () => {
  it('offers settle, close and conversion on the unified thread list', () => {
    const options = {
      settled: false,
      convertToWorktreeVisible: true,
      convertToWorktreeEnabled: false,
      closeThreadEnabled: false
    }
    expect(threadMenuActions(options)).toEqual([
      { action: 'edit', label: 'Edit', enabled: true },
      { action: 'convert-to-worktree', label: 'Converting...', enabled: false },
      { action: 'settle-thread', label: 'Settle thread', enabled: true },
      { action: 'close-thread', label: 'Closing...', enabled: false }
    ])
    expect(
      threadMenuActions({
        ...options,
        settled: true,
        convertToWorktreeEnabled: true,
        closeThreadEnabled: true
      })
    ).toEqual([
      { action: 'edit', label: 'Edit', enabled: true },
      { action: 'convert-to-worktree', label: 'Convert to work tree', enabled: true },
      { action: 'unsettle-thread', label: 'Unsettle thread', enabled: true },
      { action: 'close-thread', label: 'Close thread', enabled: true }
    ])
  })
})
