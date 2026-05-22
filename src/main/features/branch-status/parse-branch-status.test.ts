import { describe, expect, it } from 'vitest'
import { parseBranchStatus } from './parse-branch-status'

describe('parseBranchStatus', () => {
  it('parses porcelain v2 branch and working tree status', () => {
    expect(
      parseBranchStatus(
        [
          '# branch.oid abc123',
          '# branch.head main',
          '# branch.ab +2 -1',
          '1 M. N... 100644 100644 100644 a a file-staged.ts',
          '1 .M N... 100644 100644 100644 a a file-modified.ts',
          '1 .D N... 100644 100644 000000 a a file-deleted.ts',
          '2 R. N... 100644 100644 100644 a b R100 old.ts\tnew.ts',
          'u UU N... 100644 100644 100644 100644 a a a conflict.ts',
          '? untracked.ts'
        ].join('\n')
      )
    ).toEqual({
      ahead: 2,
      behind: 1,
      staged: 2,
      modified: 1,
      deleted: 1,
      untracked: 1,
      conflicted: 1
    })
  })

  it('returns a clean status for empty output', () => {
    expect(parseBranchStatus('')).toEqual({
      ahead: 0,
      behind: 0,
      staged: 0,
      modified: 0,
      deleted: 0,
      untracked: 0,
      conflicted: 0
    })
  })
})
