import { describe, expect, it } from 'vitest'
import { stepReasoningEffort } from './reasoning-effort'

describe('stepReasoningEffort', () => {
  const supported = ['high', 'low', 'medium'] as const

  it('steps through the supported efforts in order and stops at either end', () => {
    expect(stepReasoningEffort(supported, 'low', null, 1)).toBe('medium')
    expect(stepReasoningEffort(supported, 'medium', null, 1)).toBe('high')
    expect(stepReasoningEffort(supported, 'high', null, 1)).toBeNull()
    expect(stepReasoningEffort(supported, 'medium', null, -1)).toBe('low')
    expect(stepReasoningEffort(supported, 'low', null, -1)).toBeNull()
  })

  it("starts from the model's default when no effort is chosen", () => {
    expect(stepReasoningEffort(supported, null, 'medium', 1)).toBe('high')
    expect(stepReasoningEffort(supported, null, 'medium', -1)).toBe('low')
    expect(stepReasoningEffort(supported, null, null, 1)).toBe('low')
    expect(stepReasoningEffort(supported, null, null, -1)).toBeNull()
  })

  it('skips unsupported efforts and handles models without efforts', () => {
    expect(stepReasoningEffort(['low', 'max'], 'low', null, 1)).toBe('max')
    expect(stepReasoningEffort(['low', 'max'], 'high', null, -1)).toBe('low')
    expect(stepReasoningEffort([], 'low', null, 1)).toBeNull()
  })
})
