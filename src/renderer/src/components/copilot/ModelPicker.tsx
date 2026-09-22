import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { CopilotModelOption } from '../../../../shared/app-types'
import { ChevronDownIcon, ChevronRightIcon } from '../Icons'
import { modelFamily } from './model-families'

type ModelChoice = CopilotModelOption & { disabled?: boolean }

export default function ModelPicker({
  models,
  value,
  disabled,
  placeholder,
  onChange
}: {
  models: CopilotModelOption[]
  value: string
  disabled: boolean
  placeholder: string
  onChange: (id: string) => void
}): React.JSX.Element {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const submenu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [family, setFamily] = useState<string | null>(null)
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const search = useRef({ text: '', time: 0 })
  const groups = new Map<string, ModelChoice[]>()
  for (const model of models) {
    const name = modelFamily(model)
    const group = groups.get(name)
    if (group) group.push(model)
    else groups.set(name, [model])
  }
  const selected = models.find((model) => model.id === value)
  if (value && !selected)
    groups.set('Current model', [
      {
        id: value,
        name: value,
        supportsVision: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        disabled: true
      }
    ])
  const families = [...groups.keys()]
  const choices = expandedFamily ? (groups.get(expandedFamily) ?? []) : []
  const enabled = choices.filter((model) => !model.disabled)
  const visible = open && !disabled
  const familyId = (name: string): string => `${id}-family-${families.indexOf(name)}`
  const modelId = (name: string): string =>
    `${id}-model-${choices.findIndex((model) => model.id === name)}`

  function show(): void {
    setOpen(true)
    setFamily(selected ? modelFamily(selected) : (families[0] ?? null))
    setExpandedFamily(null)
    setActiveModel(null)
    search.current = { text: '', time: 0 }
  }
  function expand(name: string, keyboard = false): void {
    setFamily(name)
    setExpandedFamily(name)
    const items = groups.get(name) ?? []
    setActiveModel(
      keyboard
        ? (items.find((item) => item.id === value && !item.disabled)?.id ??
            items.find((item) => !item.disabled)?.id ??
            null)
        : null
    )
  }
  function collapse(): void {
    setExpandedFamily(null)
    setActiveModel(null)
  }
  function choose(model: ModelChoice): void {
    if (disabled || model.disabled) return
    setOpen(false)
    trigger.current?.focus()
    onChange(model.id)
  }
  function keyDown(event: KeyboardEvent): void {
    if (disabled || event.nativeEvent.isComposing) return
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Escape' && visible) {
      event.preventDefault()
      event.stopPropagation()
      if (expandedFamily) collapse()
      else setOpen(false)
      return
    }
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(
        event.key
      )
    ) {
      event.preventDefault()
      if (!visible) {
        show()
        return
      }
      if (event.key === 'ArrowLeft') {
        collapse()
        return
      }
      if (event.key === 'ArrowRight') {
        if (family) expand(family, true)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const model = choices.find((item) => item.id === activeModel)
        if (model) choose(model)
        else if (family) expand(family, true)
        return
      }
      const inModels = activeModel !== null
      const items = inModels ? enabled.map((model) => model.id) : families
      const current = items.indexOf(inModels ? activeModel! : (family ?? ''))
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      if (inModels) setActiveModel(items[next] ?? null)
      else {
        setFamily(items[next] ?? null)
        collapse()
      }
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      if (!visible) show()
      const text =
        event.timeStamp - search.current.time > 700 ? event.key : search.current.text + event.key
      search.current = { text, time: event.timeStamp }
      if (activeModel !== null) {
        const match = enabled.find((model) =>
          model.name.toLowerCase().startsWith(text.toLowerCase())
        )
        if (match) setActiveModel(match.id)
      } else {
        const match = families.find((name) => name.toLowerCase().startsWith(text.toLowerCase()))
        if (match) {
          setFamily(match)
          collapse()
        }
      }
    }
  }

  useLayoutEffect(() => {
    if (!visible) return
    const position = (): void => {
      const root = menu.current,
        button = trigger.current
      if (!root || !button) return
      const bounds = button.getBoundingClientRect()
      const width = Math.min(210, window.innerWidth - 16)
      root.style.width = `${width}px`
      root.style.maxHeight = `${Math.min(360, window.innerHeight - 16)}px`
      const height = root.offsetHeight
      root.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`
      root.style.top = `${Math.max(8, Math.min(bounds.bottom + 4 + height > window.innerHeight - 8 ? bounds.top - height - 4 : bounds.bottom + 4, window.innerHeight - height - 8))}px`
      root.style.visibility = 'visible'
      const sub = submenu.current
      const row = root.querySelector<HTMLElement>('[aria-expanded="true"]')
      if (!sub || !row) return
      const rootBounds = root.getBoundingClientRect(),
        rowBounds = row.getBoundingClientRect()
      const subWidth = Math.min(280, window.innerWidth - 16)
      sub.style.width = `${subWidth}px`
      sub.style.maxHeight = `${Math.min(360, window.innerHeight - 16)}px`
      const left =
        rootBounds.right + subWidth + 4 <= window.innerWidth - 8
          ? rootBounds.right + 4
          : rootBounds.left - subWidth - 4
      sub.style.left = `${Math.max(8, Math.min(left, window.innerWidth - subWidth - 8))}px`
      sub.style.top = `${Math.max(8, Math.min(rowBounds.top, window.innerHeight - sub.offsetHeight - 8))}px`
      sub.style.visibility = 'visible'
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [visible, expandedFamily, models.length])

  useEffect(() => {
    if (!visible) return
    const outside = (event: Event): void => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !menu.current?.contains(event.target) &&
        !submenu.current?.contains(event.target)
      )
        setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
    }
  }, [visible])
  useEffect(() => {
    if (visible)
      (activeModel ? submenu : menu).current
        ?.querySelector('[data-highlighted="true"]')
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [visible, family, activeModel])

  return (
    <div className="tm-picker tm-picker--compact">
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label="Model"
        aria-haspopup="tree"
        aria-expanded={visible}
        aria-controls={visible ? `${id}-tree` : undefined}
        aria-activedescendant={
          visible
            ? activeModel
              ? modelId(activeModel)
              : family
                ? familyId(family)
                : undefined
            : undefined
        }
        className="tm-picker-trigger"
        value={value}
        disabled={disabled}
        onKeyDown={keyDown}
        onClick={() => {
          if (visible) setOpen(false)
          else show()
        }}
      >
        <span className="tm-picker-label">{selected?.name ?? (value || placeholder)}</span>
        <ChevronDownIcon className="tm-picker-chevron" width={12} height={12} />
      </button>
      {visible &&
        createPortal(
          <>
            <div
              ref={menu}
              id={`${id}-tree`}
              role="tree"
              aria-label="Model families"
              className="tm-picker-popup"
              style={{ position: 'fixed', visibility: 'hidden' }}
            >
              {families.map((name) => (
                <div
                  key={name}
                  id={familyId(name)}
                  role="treeitem"
                  aria-label={name}
                  aria-expanded={expandedFamily === name}
                  aria-owns={expandedFamily === name ? `${id}-children` : undefined}
                  className="tm-picker-option"
                  data-highlighted={family === name}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => {
                    if (expandedFamily !== name || activeModel) expand(name)
                  }}
                  onClick={() => expand(name, true)}
                >
                  <span className="tm-picker-option-text">{name}</span>
                  {groups.get(name)?.some((model) => model.id === value) && (
                    <span className="tm-picker-check" aria-label="Contains current model">
                      ✓
                    </span>
                  )}
                  <ChevronRightIcon width={12} height={12} />
                </div>
              ))}
            </div>
            {expandedFamily && (
              <div
                ref={submenu}
                id={`${id}-children`}
                role="group"
                aria-label={`${expandedFamily} models`}
                className="tm-picker-popup"
                style={{ position: 'fixed', visibility: 'hidden' }}
              >
                <button
                  type="button"
                  className="tm-model-submenu-back"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={collapse}
                  aria-label="Back to model families"
                >
                  ‹ {expandedFamily}
                </button>
                {choices.map((model) => (
                  <div
                    key={model.id}
                    id={modelId(model.id)}
                    role="treeitem"
                    aria-label={model.name}
                    aria-level={2}
                    aria-selected={model.id === value}
                    aria-disabled={model.disabled || undefined}
                    className="tm-picker-option"
                    data-highlighted={activeModel === model.id}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => {
                      if (!model.disabled) setActiveModel(model.id)
                    }}
                    onClick={() => choose(model)}
                  >
                    <span className="tm-picker-option-text">
                      <span className="tm-picker-label">{model.name}</span>
                      {!model.disabled && (
                        <span className="tm-picker-description">
                          {model.supportsVision ? 'Supports images' : 'Text only'}
                          {model.supportedReasoningEfforts.length ? ' · Adjustable reasoning' : ''}
                        </span>
                      )}
                    </span>
                    <span className="tm-picker-check" aria-hidden="true">
                      {model.id === value ? '✓' : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>,
          document.body
        )}
    </div>
  )
}
