import { describe, expect, it } from 'vitest'
import { resolveThreadTitle, threadDisplayName } from './thread-title'

describe('thread titles', () => {
  const thread = {
    customTitle: null,
    generatedTitle: null,
    latestCopilotTitle: 'Session title',
    branchName: 'feature/x'
  }

  it('prefers a manual title, then the generated one, then the Copilot title', () => {
    expect(resolveThreadTitle(thread, 'Live title')).toBe('Live title')
    expect(resolveThreadTitle(thread, null)).toBe('Session title')
    expect(resolveThreadTitle({ ...thread, generatedTitle: 'Generated' }, 'Live')).toBe('Generated')
    expect(
      resolveThreadTitle({ ...thread, customTitle: 'Mine', generatedTitle: 'Generated' }, null)
    ).toBe('Mine')
  })

  it('names threads for messages, falling back to the branch', () => {
    expect(threadDisplayName({ ...thread, latestCopilotTitle: null })).toBe('feature/x')
    expect(threadDisplayName(undefined)).toBe('Untitled thread')
  })
})
