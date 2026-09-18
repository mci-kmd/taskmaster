import { describe, expect, it } from 'vitest'
import type { CopilotSessionSnapshot } from '../../shared/app-types'
import { collectCopilotSdkUpdateBlockers } from './copilot-update-guard'

function session(
  threadId: string,
  phase: CopilotSessionSnapshot['phase']
): Pick<CopilotSessionSnapshot, 'threadId' | 'phase'> {
  return { threadId, phase }
}

describe('collectCopilotSdkUpdateBlockers', () => {
  it('includes running and starting threads but not idle threads', () => {
    const blockers = collectCopilotSdkUpdateBlockers(
      [session('running', 'running'), session('idle', 'idle')],
      ['starting'],
      (threadId) => `Title ${threadId}`
    )

    expect(blockers).toEqual([
      { threadId: 'running', title: 'Title running' },
      { threadId: 'starting', title: 'Title starting' }
    ])
  })

  it('deduplicates a starting thread that already has a running session', () => {
    const blockers = collectCopilotSdkUpdateBlockers(
      [session('thread-1', 'running')],
      ['thread-1'],
      () => 'Thread'
    )

    expect(blockers).toEqual([{ threadId: 'thread-1', title: 'Thread' }])
  })
})
