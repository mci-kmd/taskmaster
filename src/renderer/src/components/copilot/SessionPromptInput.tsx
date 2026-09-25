import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type {
  CopilotSkill,
  CopilotSkillsResult,
  CopilotTimelineItem
} from '../../../../shared/app-types'
import { getRendererApi } from '../../shared/api/client'
import { promptHistory, stepPromptHistory, type HistoryPosition } from './composer-history'
import { completeSkill, searchSkills, skillTrigger } from './skill-completions'
import {
  applyMarkerEdit,
  attachmentMarker,
  markerRanges,
  snapOutOfMarker,
  splitAttachmentMarkers
} from './attachment-markers'
import type { SendMode } from './SendButton'

const api = getRendererApi()
const PLACEHOLDERS: Record<SendMode, string> = {
  send: 'Ask Copilot anything, / or $ for skills…',
  steer: 'Steer Copilot while it works…',
  queue: 'Queue a follow-up for when Copilot finishes…'
}

export default function SessionPromptInput({
  threadId,
  sessionId,
  connected,
  prompt,
  timeline,
  hasAttachments,
  hasInteraction,
  inputRef,
  onChange,
  onSend,
  onFiles,
  attachmentNames = [],
  mode
}: {
  threadId: string
  sessionId: string | null
  connected: boolean
  prompt: string
  timeline: CopilotTimelineItem[]
  hasAttachments: boolean
  hasInteraction: boolean
  inputRef: RefObject<HTMLTextAreaElement | null>
  onChange: (prompt: string) => void
  onSend: () => void
  onFiles: (files: File[]) => void
  attachmentNames?: string[]
  mode: SendMode
}): React.JSX.Element {
  const menuId = useId()
  const hintId = useId()
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [retry, setRetry] = useState(0)
  const [catalog, setCatalog] = useState<{ sessionId: string; result: CopilotSkillsResult } | null>(
    null
  )
  const history = useRef<HistoryPosition | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const parts = splitAttachmentMarkers(prompt, attachmentNames)
  const hasMarkers = parts.some((part) => 'attachment' in part)
  const trigger = skillTrigger(prompt, caret)
  const open = focused && !dismissed && Boolean(trigger) && !hasInteraction
  const result = catalog?.sessionId === sessionId ? catalog?.result : null
  const matches = searchSkills(result?.skills ?? [], trigger?.query ?? '')
  const activeIndex = Math.min(highlighted, Math.max(0, matches.length - 1))

  useEffect(() => {
    if (!connected || !sessionId) return
    let cancelled = false
    void api.copilot.listSkills(threadId).then(
      (result) => {
        if (!cancelled) setCatalog({ sessionId, result })
      },
      (error: unknown) => {
        if (!cancelled)
          setCatalog({
            sessionId,
            result: { skills: [], error: error instanceof Error ? error.message : String(error) }
          })
      }
    )
    return () => {
      cancelled = true
    }
  }, [threadId, sessionId, connected, retry])

  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 192)}px`
    if (pendingCaret.current !== null) {
      element.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
    if (mirror.current) mirror.current.scrollTop = element.scrollTop
  }, [prompt, inputRef])

  useLayoutEffect(() => {
    if (!open) return
    const position = (): void => {
      const element = popup.current
      const anchor = inputRef.current
      if (!element || !anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(rect.width, window.innerWidth - 16)
      const above = rect.top - 16
      const below = window.innerHeight - rect.bottom - 16
      const placeAbove = above >= Math.min(300, element.scrollHeight) || above >= below
      const height = Math.max(0, Math.min(300, placeAbove ? above : below))
      element.style.width = `${width}px`
      element.style.maxHeight = `${height}px`
      element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
      element.style.top = `${placeAbove ? Math.max(8, rect.top - Math.min(element.scrollHeight, height) - 6) : rect.bottom + 6}px`
      element.style.visibility = 'visible'
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    if (inputRef.current) observer?.observe(inputRef.current)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      observer?.disconnect()
    }
  }, [open, matches.length, result, inputRef, prompt])

  useEffect(() => {
    if (open)
      popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  const replace = (value: string, position: number): void => {
    pendingCaret.current = position
    setCaret(position)
    onChange(value)
  }
  const choose = (skill: CopilotSkill): void => {
    if (!trigger) return
    const next = completeSkill(prompt, trigger, skill)
    history.current = null
    setDismissed(true)
    replace(next.prompt, next.caret)
    inputRef.current?.focus()
  }

  return (
    <>
      <div className="tm-session-prompt" data-markers={hasMarkers || undefined}>
        {hasMarkers ? (
          <div ref={mirror} className="tm-session-prompt-mirror" aria-hidden="true">
            {parts.map((part, index) =>
              'text' in part ? (
                part.text
              ) : (
                <span className="tm-session-prompt-marker" key={index}>
                  <span className="tm-session-prompt-bracket">[</span>
                  {attachmentMarker(part.attachment).slice(1, -1)}
                  <span className="tm-session-prompt-bracket">]</span>
                </span>
              )
            )}{' '}
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          autoFocus
          role="combobox"
          aria-label="Message Copilot"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-activedescendant={open && matches.length ? `${menuId}-${activeIndex}` : undefined}
          aria-describedby={hintId}
          rows={2}
          value={prompt}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setDismissed(false)
          }}
          onScroll={(event) => {
            if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop
          }}
          onSelect={(event) => {
            const element = event.currentTarget
            if (element.selectionStart === element.selectionEnd) {
              const snapped = snapOutOfMarker(prompt, attachmentNames, element.selectionStart)
              if (snapped !== element.selectionStart) element.setSelectionRange(snapped, snapped)
            }
            setCaret(element.selectionStart)
          }}
          onChange={(event) => {
            history.current = null
            setDismissed(false)
            setHighlighted(0)
            const element = event.currentTarget
            const edit = applyMarkerEdit(
              prompt,
              element.value,
              attachmentNames,
              element.selectionEnd
            )
            if (edit) {
              replace(edit.prompt, edit.caret)
              return
            }
            setCaret(element.selectionStart)
            onChange(element.value)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (
              (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
              !event.shiftKey &&
              !event.altKey &&
              !event.metaKey &&
              !event.ctrlKey
            ) {
              const element = event.currentTarget
              const position = element.selectionStart
              const right = event.key === 'ArrowRight'
              const marker =
                element.selectionStart === element.selectionEnd &&
                markerRanges(prompt, attachmentNames).find((range) =>
                  right
                    ? range.start <= position && position < range.end
                    : range.start < position && position <= range.end
                )
              if (marker) {
                event.preventDefault()
                const target = right ? marker.end : marker.start
                element.setSelectionRange(target, target)
                setCaret(target)
                return
              }
            }
            if (open && !event.ctrlKey && !event.metaKey && !event.altKey) {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setDismissed(true)
                return
              }
              if (!event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault()
                setHighlighted(
                  matches.length
                    ? (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                        matches.length
                    : 0
                )
                return
              }
              if (
                !event.shiftKey &&
                (event.key === 'Enter' || event.key === 'Tab') &&
                matches.length
              ) {
                event.preventDefault()
                choose(matches[activeIndex])
                return
              }
              // An open completion menu never submits a partial or unmatched command.
              if (!event.shiftKey && event.key === 'Enter') {
                event.preventDefault()
                return
              }
            }
            if (
              !event.shiftKey &&
              !event.altKey &&
              !event.metaKey &&
              !event.ctrlKey &&
              !hasAttachments &&
              !hasInteraction &&
              (event.key === 'ArrowUp' || event.key === 'ArrowDown')
            ) {
              const element = event.currentTarget
              const older = event.key === 'ArrowUp'
              const atEdge = older
                ? element.selectionStart === 0
                : element.selectionEnd === prompt.length || !prompt.includes('\n')
              if (element.selectionStart === element.selectionEnd && atEdge) {
                const step = stepPromptHistory(
                  promptHistory(timeline),
                  history.current,
                  prompt,
                  older ? 'older' : 'newer'
                )
                if (step) {
                  event.preventDefault()
                  history.current = step.position
                  setDismissed(true)
                  replace(step.prompt, older ? 0 : step.prompt.length)
                  return
                }
              }
            }
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.metaKey
            ) {
              event.preventDefault()
              onSend()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length) {
              event.preventDefault()
              onFiles(files)
            }
          }}
          placeholder={PLACEHOLDERS[mode]}
        />
      </div>
      <span id={hintId} className="sr-only">
        Up and Down recall sent prompts from an empty message. Type / or $ for skills, use arrows to
        browse, Tab or Enter to insert, and Escape to dismiss.
      </span>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="tm-picker-popup tm-skill-menu"
            style={{ position: 'fixed', visibility: 'hidden' }}
          >
            <div className="tm-skill-menu-heading">
              Skills <span>↑↓ browse · Tab insert · Esc close</span>
            </div>
            <div role="listbox" id={menuId} aria-label="Skills">
              {matches.map((skill, index) => (
                <button
                  type="button"
                  role="option"
                  id={`${menuId}-${index}`}
                  key={skill.commandName}
                  aria-selected={index === activeIndex}
                  tabIndex={-1}
                  className="tm-skill-option"
                  data-highlighted={index === activeIndex}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => setHighlighted(index)}
                  onClick={() => choose(skill)}
                >
                  <span className="tm-skill-option-title">
                    {trigger?.prefix}
                    {skill.commandName}
                    <span>{skill.argumentHint}</span>
                  </span>
                  <span className="tm-skill-option-description">{skill.description}</span>
                  <span className="tm-skill-option-source">
                    {skill.source.replaceAll('-', ' ')}
                  </span>
                </button>
              ))}
            </div>
            {!matches.length && (
              <div className="tm-skill-menu-empty" role="status">
                {!connected
                  ? 'Connect to Copilot to browse skills.'
                  : !result
                    ? 'Loading skills…'
                    : result.error
                      ? 'Could not load skills.'
                      : result.skills.length
                        ? 'No matching skills.'
                        : 'No skills available for this session.'}
                {result?.error && (
                  <>
                    <span>{result.error}</span>
                    <button
                      type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setCatalog(null)
                        setRetry((value) => value + 1)
                      }}
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
