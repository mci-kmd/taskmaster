import { describe, expect, it } from 'vitest'
import {
  buildBranchNamePrompt,
  cleanGeneratedBranchName,
  fallbackBranchName,
  toBranchName,
  uniqueBranchName
} from './thread-branch-name'

describe('thread branch names', () => {
  it('turns free text into a safe branch name', () => {
    expect(toBranchName('Fix the Café login!')).toBe('fix-the-cafe-login')
    expect(toBranchName('  ~^: ')).toBeNull()
    expect(toBranchName('word '.repeat(40))?.length).toBeLessThanOrEqual(60)
  })

  it('reads the name from the model reply', () => {
    expect(cleanGeneratedBranchName('`12431234-build-the-thing`')).toBe('12431234-build-the-thing')
    expect(cleanGeneratedBranchName('Branch name: feature/Add-Login.\nBecause…')).toBe('add-login')
    expect(cleanGeneratedBranchName('\n  \n')).toBeNull()
  })

  it('names a branch from the prompt, keeping a work item number first', () => {
    expect(fallbackBranchName('Story 12431234: build the thing')).toBe(
      '12431234-story-build-the-thing'
    )
    expect(fallbackBranchName('Add a dark mode toggle to the settings page please')).toBe(
      'add-a-dark-mode-toggle-to'
    )
    expect(fallbackBranchName('???')).toBe('thread')
  })

  it('adds the lowest free suffix to a taken name', () => {
    const taken = new Set(['fix', 'fix-2'])
    expect(uniqueBranchName('new', (name) => taken.has(name))).toBe('new')
    expect(uniqueBranchName('fix', (name) => taken.has(name))).toBe('fix-3')
  })

  it('caps the prompt sent to the model', () => {
    const prompt = buildBranchNamePrompt('x'.repeat(5_000))
    expect(prompt.length).toBeLessThan(1_600)
    expect(prompt.endsWith('…')).toBe(true)
  })
})
