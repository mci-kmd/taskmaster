import { useState } from 'react'
import type { RepositorySnapshot } from '../../../shared/app-types'
import { PROJECT_ICONS, PROJECT_ICON_COLORS } from '../../../shared/project-icons'

export function ProjectGlyph({
  icon,
  color
}: {
  icon?: string
  color?: string
}): React.JSX.Element {
  const definition = PROJECT_ICONS.find((item) => item.id === icon) ?? PROJECT_ICONS[0]
  const resolvedColor = PROJECT_ICON_COLORS.find((item) => item.value === color)?.value
  return (
    <svg
      aria-hidden="true"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: resolvedColor === 'default' ? undefined : resolvedColor }}
    >
      <path d={definition.path} />
    </svg>
  )
}

export default function ProjectIcon({
  repository
}: {
  repository: Pick<RepositorySnapshot, 'faviconUrl' | 'icon' | 'iconColor'>
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-[var(--color-fg-subtle)]">
      {repository.faviconUrl && failedUrl !== repository.faviconUrl ? (
        <img
          alt=""
          className="size-4 rounded object-contain"
          draggable={false}
          src={repository.faviconUrl}
          onError={() => setFailedUrl(repository.faviconUrl)}
        />
      ) : (
        <ProjectGlyph icon={repository.icon} color={repository.iconColor} />
      )}
    </span>
  )
}
