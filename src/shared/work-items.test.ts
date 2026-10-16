import { describe, expect, it } from 'vitest'
import {
  formatWorkItemReference,
  normalizeThreadWorkItems,
  parseWorkItemReference
} from './work-items'

describe('work items', () => {
  it('parses GitHub issues and pull requests', () => {
    expect(parseWorkItemReference(' octo/app#12 ')).toEqual({
      provider: 'github',
      url: 'https://github.com/octo/app/issues/12',
      container: 'octo/app',
      number: 12
    })
    expect(parseWorkItemReference('https://github.com/octo/app/pull/7/files?w=1')).toEqual({
      provider: 'github',
      url: 'https://github.com/octo/app/pull/7',
      container: 'octo/app',
      number: 7
    })
  })

  it('canonicalizes Azure DevOps work item URLs', () => {
    const expected = {
      provider: 'azure-devops',
      url: 'https://dev.azure.com/contoso/My%20Project/_workitems/edit/345',
      container: 'contoso/My Project',
      number: 345
    }
    expect(
      parseWorkItemReference('https://dev.azure.com/contoso/My%20Project/_workitems/edit/345/')
    ).toEqual(expected)
    expect(
      parseWorkItemReference(
        'https://contoso.visualstudio.com/DefaultCollection/My%20Project/_workitems/edit/345'
      )
    ).toEqual(expected)
    expect(formatWorkItemReference(expected)).toBe('contoso/My Project#345')
  })

  it('rejects other references', () => {
    for (const value of [
      '',
      '#12',
      'https://example.com/a/b/_workitems/edit/1',
      'https://github.com/octo/app/issues/0',
      'https://dev.azure.com/contoso/_workitems/edit/1'
    ]) {
      expect(parseWorkItemReference(value)).toBeNull()
    }
  })

  it('normalizes persisted links, dropping invalid entries and duplicates', () => {
    expect(normalizeThreadWorkItems(undefined)).toBeUndefined()
    expect(normalizeThreadWorkItems([{ url: 'nope' }])).toBeUndefined()
    expect(
      normalizeThreadWorkItems([
        { url: 'https://github.com/octo/app/issues/1', title: '  Fix\n it ' },
        { url: 'octo/app#1' },
        null,
        { url: 'https://github.com/octo/app/pull/2', title: '' }
      ])
    ).toEqual([
      {
        provider: 'github',
        url: 'https://github.com/octo/app/issues/1',
        container: 'octo/app',
        number: 1,
        title: 'Fix it'
      },
      {
        provider: 'github',
        url: 'https://github.com/octo/app/pull/2',
        container: 'octo/app',
        number: 2
      }
    ])
  })
})
