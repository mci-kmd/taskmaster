import type { FileType, Hunk } from 'gitdiff-parser'

export type SkippedHunkInfo = {
  linesSkipped: number
  label: string
}

function clampGap(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function resolveSkippedLineCount(diffType: FileType, previousHunk: Hunk, nextHunk: Hunk): number {
  const oldGap = clampGap(nextHunk.oldStart - (previousHunk.oldStart + previousHunk.oldLines))
  const newGap = clampGap(nextHunk.newStart - (previousHunk.newStart + previousHunk.newLines))

  if (diffType === 'add') {
    return newGap
  }

  if (diffType === 'delete') {
    return oldGap
  }

  return oldGap === newGap ? oldGap : Math.max(oldGap, newGap)
}

export function formatSkippedLinesLabel(linesSkipped: number): string {
  return `${linesSkipped} ${linesSkipped === 1 ? 'line' : 'lines'}`
}

export function getSkippedHunkInfo(
  diffType: FileType,
  previousHunk: Hunk,
  nextHunk: Hunk
): SkippedHunkInfo | null {
  const linesSkipped = resolveSkippedLineCount(diffType, previousHunk, nextHunk)
  if (linesSkipped <= 0) {
    return null
  }

  return {
    linesSkipped,
    label: formatSkippedLinesLabel(linesSkipped)
  }
}
