import { describe, expect, it } from 'vitest'
import { mergePresenceEntries, type PresenceEntry } from './use-presence-list'

const key = (item: string): string => item

function entries(...items: string[]): PresenceEntry<string>[] {
  return items.map((item) => ({ key: item, item, exitToken: null }))
}

describe('mergePresenceEntries', () => {
  it('keeps removed entries after their previous neighbour as exiting', () => {
    const merged = mergePresenceEntries(entries('a', 'b', 'c', 'd'), ['a', 'd', 'e'], key)

    expect(merged.map((entry) => [entry.key, entry.exitToken !== null])).toEqual([
      ['a', false],
      ['b', true],
      ['c', true],
      ['d', false],
      ['e', false]
    ])
  })

  it('keeps leading removed entries first and revives re-added entries', () => {
    const first = mergePresenceEntries(entries('a', 'b'), ['b'], key)
    expect(first.map((entry) => [entry.key, entry.exitToken !== null])).toEqual([
      ['a', true],
      ['b', false]
    ])

    const revived = mergePresenceEntries(first, ['a', 'b'], key)
    expect(revived.map((entry) => [entry.key, entry.exitToken])).toEqual([
      ['a', null],
      ['b', null]
    ])
  })

  it('keeps the exit token of entries that are already exiting', () => {
    const first = mergePresenceEntries(entries('a', 'b'), ['a'], key)
    const second = mergePresenceEntries(first, ['a'], key)
    expect(second[1].exitToken).toBe(first[1].exitToken)
  })
})
