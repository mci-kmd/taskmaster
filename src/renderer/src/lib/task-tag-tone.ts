import type { ProjectTaskTag } from '../../../shared/app-types'

/** Color family of a task tag; `.tm-label-chip[data-tone]` (styles/components/tasks.css) maps it to tokens. */
export type TaskTagTone = 'danger' | 'accent' | 'accent-2'

export function getTaskTagTone(tag: ProjectTaskTag): TaskTagTone {
  switch (tag.trim().toLowerCase()) {
    case 'bug':
      return 'danger'
    case 'feature':
      return 'accent'
    default:
      return 'accent-2'
  }
}
