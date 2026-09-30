import { expect, it } from 'vitest'
import { formatPromptCredits, formatPromptDkk, formatPromptDuration } from './prompt-cost'

it('formats durations compactly', () => {
  expect(formatPromptDuration(840)).toBe('0.8s')
  expect(formatPromptDuration(42_400)).toBe('42s')
  expect(formatPromptDuration(185_000)).toBe('3m 05s')
  expect(formatPromptDuration(3_720_000)).toBe('1h 02m')
})

it('formats credits and the DKK estimate', () => {
  expect(formatPromptCredits(12_345_000_000)).toBe('12.35 credits')
  expect(formatPromptCredits(1_000_000)).toBe('<0.01 credits')
  expect(formatPromptCredits(0)).toBe('0.00 credits')
  expect(formatPromptDkk(100_000_000_000)).toBe('≈6.58 DKK')
  expect(formatPromptDkk(10_000_000)).toBe('<0.01 DKK')
})
