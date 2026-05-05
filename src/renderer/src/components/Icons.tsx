import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const baseProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  )
}

export function FolderIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2.5 4.5a1 1 0 0 1 1-1H6l1.5 1.5h5a1 1 0 0 1 1 1V11.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7Z" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="m6 4 4 4-4 4" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

export function GearIcon(props: IconProps): React.JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function InfoIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6" />
      <circle cx="8" cy="5.2" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PlayIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 3.5v9l7.5-4.5L5 3.5Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function StopIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M13.5 4v3h-3" />
      <path d="M2.5 12V9h3" />
      <path d="M3.4 7a5 5 0 0 1 8.7-1.5L13.5 7M12.6 9a5 5 0 0 1-8.7 1.5L2.5 9" />
    </svg>
  )
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}

export function TrashIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3 4.5h10M6.5 4.5V3.2a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.3M4.5 4.5l.6 8.2a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.2" />
    </svg>
  )
}

export function BranchIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="4" cy="3.5" r="1.3" />
      <circle cx="4" cy="12.5" r="1.3" />
      <circle cx="12" cy="6" r="1.3" />
      <path d="M4 4.8v6.4M4 8.5h4a4 4 0 0 0 4-4v-.7" />
    </svg>
  )
}

export function WorktreeIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M8 2.7a2.4 2.4 0 0 0-2.4 2.4v.3a2.2 2.2 0 0 0-1.7 2.1c0 1.2 1 2.2 2.2 2.2h3.8c1.2 0 2.2-1 2.2-2.2 0-1-.7-1.9-1.7-2.1v-.3A2.4 2.4 0 0 0 8 2.7Z" />
      <path d="M8 9.7v3.1M6.5 12.8h3" />
    </svg>
  )
}

export function ThreadIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M3 4.5h10M3 8h7M3 11.5h5" />
    </svg>
  )
}

export function SparkIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...baseProps} {...props}>
      <path d="M8 2.5 9.2 6.4 13 7.6l-3.8 1.2L8 12.7 6.8 8.8 3 7.6l3.8-1.2L8 2.5Z" />
    </svg>
  )
}

export function LogoMark(props: IconProps): React.JSX.Element {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3.5 6.5 10 3l6.5 3.5L10 10 3.5 6.5Z" />
      <path d="M3.5 10 10 13.5 16.5 10" opacity="0.55" />
      <path d="M3.5 13.5 10 17l6.5-3.5" opacity="0.3" />
    </svg>
  )
}
