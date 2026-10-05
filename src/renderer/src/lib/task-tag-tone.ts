import type { CSSProperties } from 'react'
import type { ProjectTaskTag } from '../../../shared/app-types'

export function getTaskTagChipStyle(tag: ProjectTaskTag): CSSProperties {
  const [border, bg, fg] = getTaskTagColors(tag)
  return {
    '--tm-chip-border': border,
    '--tm-chip-bg': bg,
    '--tm-chip-fg': fg
  } as CSSProperties
}

function getTaskTagColors(tag: ProjectTaskTag): [string, string, string] {
  switch (tag.trim().toLowerCase()) {
    case 'bug':
      return ['rgba(240,140,140,0.35)', 'rgba(240,140,140,0.1)', 'var(--color-danger)']
    case 'feature':
      return ['rgba(158,197,255,0.35)', 'rgba(158,197,255,0.1)', 'var(--color-info)']
    default:
      return ['rgba(196,167,255,0.35)', 'rgba(196,167,255,0.1)', '#c4a7ff']
  }
}

export function getTaskTagTone(tag: ProjectTaskTag): string {
  switch (tag.trim().toLowerCase()) {
    case 'bug':
      return 'border-[rgba(240,140,140,0.35)] bg-[rgba(240,140,140,0.1)] text-[var(--color-danger)]'
    case 'feature':
      return 'border-[rgba(158,197,255,0.35)] bg-[rgba(158,197,255,0.1)] text-[var(--color-info)]'
    default:
      return 'border-[rgba(196,167,255,0.35)] bg-[rgba(196,167,255,0.1)] text-[#c4a7ff]'
  }
}
