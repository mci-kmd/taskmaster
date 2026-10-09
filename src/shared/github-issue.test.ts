import { describe, expect, it } from 'vitest'
import { formatGitHubIssueReference, parseGitHubIssueReference } from './github-issue'

describe('parseGitHubIssueReference', () => {
  it('parses issue URLs and owner/repo#number into a canonical URL', () => {
    for (const input of [
      'https://github.com/octo/my.repo/issues/12',
      '  http://www.github.com/octo/my.repo/issues/12/  ',
      'https://GitHub.com/octo/my.repo/issues/12?x=1#issuecomment-5',
      'octo/my.repo#12'
    ]) {
      expect(parseGitHubIssueReference(input)).toEqual({
        owner: 'octo',
        repo: 'my.repo',
        number: 12,
        url: 'https://github.com/octo/my.repo/issues/12'
      })
    }
  })

  it('rejects anything that is not a GitHub issue', () => {
    for (const input of [
      '',
      undefined,
      '#12',
      'octo#12',
      'https://github.com/octo/repo/pull/12',
      'https://github.com/octo/repo/issues/0',
      'https://example.com/octo/repo/issues/12',
      'https://github.com/octo/repo/issues/12abc',
      'javascript:alert(1)//github.com/a/b/issues/1'
    ]) {
      expect(parseGitHubIssueReference(input)).toBeNull()
    }
  })

  it('formats references as owner/repo#number', () => {
    const reference = parseGitHubIssueReference('https://github.com/octo/repo/issues/3')!
    expect(formatGitHubIssueReference(reference)).toBe('octo/repo#3')
  })
})
