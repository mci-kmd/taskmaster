import type { FileType, Hunk } from 'gitdiff-parser'
import { describe, expect, it } from 'vitest'

import { formatSkippedLinesLabel, getSkippedHunkInfo } from './diff-hunks'

function createHunk(values: Pick<Hunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>): Hunk {
  return {
    content: `@@ -${values.oldStart},${values.oldLines} +${values.newStart},${values.newLines} @@`,
    changes: [],
    ...values
  }
}

function getLabel(diffType: FileType, previousHunk: Hunk, nextHunk: Hunk): string | null {
  return getSkippedHunkInfo(diffType, previousHunk, nextHunk)?.label ?? null
}

describe('diff hunk markers', () => {
  it('formats singular and plural labels', () => {
    expect(formatSkippedLinesLabel(1)).toBe('1 line')
    expect(formatSkippedLinesLabel(22)).toBe('22 lines')
  })

  it('returns null when hunks are adjacent', () => {
    const previousHunk = createHunk({ oldStart: 10, oldLines: 3, newStart: 10, newLines: 3 })
    const nextHunk = createHunk({ oldStart: 13, oldLines: 2, newStart: 13, newLines: 2 })

    expect(getSkippedHunkInfo('modify', previousHunk, nextHunk)).toBeNull()
  })

  it('counts skipped unchanged lines for modified files', () => {
    const previousHunk = createHunk({ oldStart: 39, oldLines: 6, newStart: 42, newLines: 6 })
    const nextHunk = createHunk({ oldStart: 67, oldLines: 3, newStart: 70, newLines: 3 })

    expect(getLabel('modify', previousHunk, nextHunk)).toBe('22 lines')
  })

  it('uses new-file line numbers for added files', () => {
    const previousHunk = createHunk({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 3 })
    const nextHunk = createHunk({ oldStart: 0, oldLines: 0, newStart: 10, newLines: 2 })

    expect(getLabel('add', previousHunk, nextHunk)).toBe('6 lines')
  })

  it('uses old-file line numbers for deleted files', () => {
    const previousHunk = createHunk({ oldStart: 5, oldLines: 2, newStart: 0, newLines: 0 })
    const nextHunk = createHunk({ oldStart: 11, oldLines: 1, newStart: 0, newLines: 0 })

    expect(getLabel('delete', previousHunk, nextHunk)).toBe('4 lines')
  })

  it('suppresses overlapping or malformed gaps', () => {
    const previousHunk = createHunk({ oldStart: 10, oldLines: 4, newStart: 10, newLines: 4 })
    const nextHunk = createHunk({ oldStart: 12, oldLines: 2, newStart: 12, newLines: 2 })

    expect(getSkippedHunkInfo('modify', previousHunk, nextHunk)).toBeNull()
  })
})
