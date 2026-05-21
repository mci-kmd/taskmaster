import type { BranchStatusSnapshot } from '../../../shared/app-types'

export function parseBranchStatus(stdout: string): BranchStatusSnapshot {
  const status: BranchStatusSnapshot = {
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    deleted: 0,
    untracked: 0,
    conflicted: 0
  }

  for (const line of stdout.split(/\r?\n/)) {
    if (!line) {
      continue
    }

    if (line.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
      if (match) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
      continue
    }

    if (line.startsWith('? ')) {
      status.untracked += 1
      continue
    }

    if (line.startsWith('u ')) {
      status.conflicted += 1
      continue
    }

    if (!line.startsWith('1 ') && !line.startsWith('2 ')) {
      continue
    }

    const xy = line.split(' ', 3)[1] ?? '..'
    const indexStatus = xy[0] ?? '.'
    const worktreeStatus = xy[1] ?? '.'

    if (indexStatus !== '.') {
      status.staged += 1
    }

    if (worktreeStatus === 'D') {
      status.deleted += 1
      continue
    }

    if (worktreeStatus !== '.') {
      status.modified += 1
    }
  }

  return status
}
