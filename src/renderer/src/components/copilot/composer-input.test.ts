import { describe, expect, it } from 'vitest'
import { promptHistory, stepPromptHistory } from './composer-history'
import { skillTrigger, completeSkill, searchSkills } from './skill-completions'

const skill = {
  name: 'review',
  commandName: 'review',
  description: 'Find defects',
  source: 'project'
}

describe('composer input helpers', () => {
  it('keeps recalled messages stable when older history arrives or duplicate ids are replaced', () => {
    const entries = [
      { id: 'a', prompt: 'First' },
      { id: 'b', prompt: 'Second' }
    ]
    const position = { id: 'retired-b', prompt: 'Second' }
    expect(stepPromptHistory(entries, position, 'Second', 'older')?.prompt).toBe('First')
    expect(
      stepPromptHistory(
        [{ id: 'older', prompt: 'Earlier' }, ...entries],
        entries[0],
        'First',
        'newer'
      )?.prompt
    ).toBe('Second')
    expect(stepPromptHistory(entries, position, 'Edited', 'older')).toBeNull()
    expect(stepPromptHistory([], null, '', 'older')).toBeNull()
  })

  it('retains nonconsecutive repeated commands but excludes blank messages', () => {
    expect(
      promptHistory(
        ['a', 'a', '', 'b', 'a'].map((content, i) => ({
          id: String(i),
          type: 'user',
          content,
          timestamp: ''
        }))
      ).map((entry) => entry.prompt)
    ).toEqual(['a', 'b', 'a'])
  })

  it('only completes leading slash commands and dollar references at token boundaries', () => {
    expect(skillTrigger('/rev', 4)).toMatchObject({ prefix: '/', query: 'rev' })
    expect(skillTrigger('Use $rev', 8)).toMatchObject({ prefix: '$', query: 'rev' })
    expect(skillTrigger('src/rev', 7)).toBeNull()
    expect(skillTrigger('https://example', 15)).toBeNull()
    expect(skillTrigger('Use /rev', 8)).toBeNull()
    expect(skillTrigger('/review args', 12)).toBeNull()
    expect(skillTrigger('cost$rev', 8)).toBeNull()
  })

  it('replaces the whole token when completing from the middle and retains trailing arguments', () => {
    const prompt = '/revXYZ keep this'
    const trigger = skillTrigger(prompt, 4)!
    expect(completeSkill(prompt, trigger, skill)).toEqual({ prompt: '/review keep this', caret: 8 })
  })

  it('ranks command matches ahead of description matches and supports abbreviations', () => {
    const other = { ...skill, name: 'audit', commandName: 'audit', description: 'Review changes' }
    expect(searchSkills([other, skill], 'rev').map((item) => item.name)).toEqual([
      'review',
      'audit'
    ])
    expect(searchSkills([skill], 'rvw')).toEqual([skill])
    expect(searchSkills([skill], 'defects')).toEqual([skill])
    expect(searchSkills([skill], 'xyz')).toEqual([])
  })
})
