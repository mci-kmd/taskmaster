import { memo, useEffect, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckIcon, CloseIcon, CopyIcon } from '../Icons'
import Button from '../ui/Button'
import { highlightCode } from './highlight-code'
import { safeExternalUrl } from './safe-external-url'

type CopyStatus = 'Copied' | 'Copy failed'

export function CopyButton({
  text,
  label = 'Copy',
  iconOnly = false
}: {
  text: string
  label?: string
  iconOnly?: boolean
}): React.JSX.Element | null {
  const [status, setStatus] = useState<CopyStatus | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  if (!text.trim()) return null
  return (
    <Button
      size="xs"
      variant="ghost"
      iconOnly={iconOnly}
      className="tm-session-copy"
      data-status={status ?? undefined}
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
        // The three icons share one cell and crossfade as the status changes.
        <span className="tm-icon-swap" aria-hidden="true">
          <CopyIcon data-active={status === null} />
          <CheckIcon data-active={status === 'Copied'} className="text-positive" />
          <CloseIcon data-active={status === 'Copy failed'} className="text-danger" />
        </span>
      ) : null}
      <span className={iconOnly ? 'sr-only' : undefined} aria-live="polite">
        <span key={status ?? 'idle'} className={iconOnly ? undefined : 'tm-fade-in'}>
          {status ?? label}
        </span>
      </span>
    </Button>
  )
}

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const element = node as { type?: string; value?: string; children?: unknown[] }
  if (element.type === 'text') return element.value ?? ''
  return (element.children ?? []).map(textOf).join('')
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
  img: ({ alt }) => <span className="text-fg-muted">{alt || 'Image'}</span>,
  pre: ({ children, node }) => {
    const code = node?.children[0]
    if (code?.type !== 'element' || code.tagName !== 'code') return <pre>{children}</pre>
    const text = textOf(code)
    const classes = code.properties.className
    const language = (Array.isArray(classes) ? classes : [])
      .map(String)
      .find((name) => name.startsWith('language-'))
      ?.slice('language-'.length)
    return (
      <div className="tm-session-code">
        <div className="tm-session-code-toolbar">
          <span>{language || 'Code'}</span>
          <CopyButton text={text} label="Copy code" iconOnly />
        </div>
        <pre>
          <code>
            {highlightCode(text.replace(/\n$/, ''), language).map((token, index) =>
              token.kind ? (
                <span className={`tm-syntax-${token.kind}`} key={index}>
                  {token.text}
                </span>
              ) : (
                token.text
              )
            )}
          </code>
        </pre>
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
