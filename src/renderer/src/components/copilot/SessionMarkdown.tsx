import { memo, useEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckIcon, CloseIcon, CopyIcon } from '../Icons'
import { safeExternalUrl } from './safe-external-url'

export function CopyButton({
  text,
  label = 'Copy',
  iconOnly = false
}: {
  text: string
  label?: string
  iconOnly?: boolean
}): React.JSX.Element | null {
  const [status, setStatus] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  if (!text.trim()) return null
  return (
    <button
      type="button"
      className={iconOnly ? 'tm-session-copy tm-session-copy--icon' : 'tm-session-copy'}
      aria-label={label}
      title={status ?? label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setStatus('Copied')
        } catch {
          setStatus('Copy failed')
        }
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setStatus(null), 2000)
      }}
    >
      {iconOnly ? (
        status === 'Copied' ? (
          <CheckIcon aria-hidden="true" className="text-[var(--color-positive)]" />
        ) : status === 'Copy failed' ? (
          <CloseIcon aria-hidden="true" className="text-[var(--color-danger)]" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )
      ) : null}
      <span className={iconOnly ? 'sr-only' : undefined} aria-live="polite">
        {status ?? label}
      </span>
    </button>
  )
}

const components: Components = {
  a: ({ href, children }) =>
    safeExternalUrl(href) ? (
      <a href={safeExternalUrl(href)} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Do not fetch arbitrary remote images embedded in agent output.
  img: ({ alt }) => <span className="text-[var(--color-fg-muted)]">{alt || 'Image'}</span>,
  pre: ({ children, node }) => {
    const code = node?.children[0]
    const text =
      code?.type === 'element'
        ? code.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
        : ''
    return (
      <div className="tm-session-code">
        <div className="tm-session-code-toolbar">
          <span>Code</span>
          <CopyButton text={text} label="Copy code" />
        </div>
        <pre>{children}</pre>
      </div>
    )
  },
  table: ({ children }) => (
    <div className="tm-session-table">
      <table>{children}</table>
    </div>
  )
}

const SessionMarkdown = memo(function SessionMarkdown({
  children
}: {
  children: string
}): React.JSX.Element {
  return (
    <div className="tm-session-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  )
})

export default SessionMarkdown
