import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon } from '../Icons'

export type SelectOption = {
  value: string
  label: string
  description?: string
  icon?: ReactNode
  disabled?: boolean
}

type SelectProps = {
  options: SelectOption[]
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  title?: string
  className?: string
  disabled?: boolean
  required?: boolean
  placeholder?: string
  compact?: boolean
} & (
  | {
      value: string
      onChange: (value: string) => void
      multiple?: false
      editable?: boolean
    }
  | {
      value: string[]
      onChange: (value: string[]) => void
      multiple: true
      editable?: false
    }
)

/** A shared, portal-based picker. Focus stays on the trigger while navigating its listbox. */
export default function Select(props: SelectProps): React.JSX.Element {
  const {
    options,
    disabled = false,
    required,
    placeholder = 'Select…',
    compact,
    className = '',
    id,
    title
  } = props
  const generatedId = useId()
  const listId = `${generatedId}-options`
  const trigger = useRef<HTMLButtonElement | HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeValue, setActiveValue] = useState<string | null>(null)
  const [position, setPosition] = useState<CSSProperties>({})
  const [invalid, setInvalid] = useState(false)
  const search = useRef({ text: '', time: 0 })
  const values = Array.isArray(props.value) ? props.value : [props.value]
  const selected = options.filter((option) => values.includes(option.value))
  const query = props.editable ? String(props.value).toLowerCase() : ''
  const visibleOptions = props.editable
    ? options.filter((option) =>
        `${option.label} ${option.value} ${option.description ?? ''}`.toLowerCase().includes(query)
      )
    : options
  const enabledOptions = visibleOptions.filter((option) => !option.disabled)
  const activeIndex = visibleOptions.findIndex(
    (option) => option.value === activeValue && !option.disabled
  )
  const expanded = open && !disabled
  const label = selected.length
    ? selected.map((option) => option.label).join(', ')
    : values.filter(Boolean).join(', ') || placeholder

  function show(direction: 'first' | 'last' = 'first'): void {
    if (disabled || trigger.current?.matches(':disabled')) return
    setOpen(true)
    setActiveValue(
      selected.find((option) => !option.disabled)?.value ??
        (direction === 'last' ? enabledOptions.at(-1)?.value : enabledOptions[0]?.value) ??
        null
    )
  }

  function choose(option: SelectOption): void {
    if (option.disabled || disabled || trigger.current?.matches(':disabled')) return
    setInvalid(false)
    if (props.multiple) {
      props.onChange(
        values.includes(option.value)
          ? values.filter((value) => value !== option.value)
          : [...values, option.value]
      )
    } else {
      props.onChange(option.value)
      setOpen(false)
    }
    trigger.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.nativeEvent.isComposing || disabled) return
    if (event.key === 'Escape' && expanded) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      if (!expanded) {
        show(event.key === 'ArrowUp' ? 'last' : 'first')
        return
      }
      const index = enabledOptions.findIndex((option) => option.value === activeValue)
      const next =
        index < 0
          ? event.key === 'ArrowDown'
            ? 0
            : enabledOptions.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabledOptions.length) %
            enabledOptions.length
      setActiveValue(enabledOptions[next]?.value ?? null)
    } else if (expanded && !props.editable && ['Home', 'End'].includes(event.key)) {
      event.preventDefault()
      setActiveValue(
        (event.key === 'Home' ? enabledOptions[0] : enabledOptions.at(-1))?.value ?? null
      )
    } else if (event.key === 'Enter' || (event.key === ' ' && !props.editable)) {
      if (expanded) {
        event.preventDefault()
        if (activeIndex >= 0) choose(visibleOptions[activeIndex])
        else setOpen(false)
      } else if (!props.editable) {
        event.preventDefault()
        show()
      }
    } else if (
      !props.editable &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault()
      const now = Date.now()
      search.current.text =
        now - search.current.time > 700 ? event.key : search.current.text + event.key
      search.current.time = now
      const match = enabledOptions.find((option) =>
        option.label.toLowerCase().startsWith(search.current.text.toLowerCase())
      )
      setOpen(true)
      if (match) setActiveValue(match.value)
    }
  }

  useLayoutEffect(() => {
    if (!expanded) return
    const update = (): void => {
      const bounds = trigger.current?.getBoundingClientRect()
      if (!bounds) return
      const margin = 8,
        gap = 4
      const width = Math.min(Math.max(bounds.width, 280), window.innerWidth - margin * 2)
      const below = window.innerHeight - bounds.bottom - margin - gap
      const above = bounds.top - margin - gap
      const upwards = below < 220 && above > below
      setPosition({
        position: 'fixed',
        width,
        left: Math.max(margin, Math.min(bounds.left, window.innerWidth - width - margin)),
        maxHeight: Math.min(360, Math.max(0, upwards ? above : below)),
        ...(upwards
          ? { bottom: window.innerHeight - bounds.top + gap }
          : { top: bounds.bottom + gap })
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (trigger.current) observer?.observe(trigger.current)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: Event): void => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('focusin', dismiss)
    }
  }, [expanded])

  useEffect(() => {
    if (expanded && activeIndex >= 0)
      popup.current
        ?.querySelector(`[id="${listId}-${activeIndex}"]`)
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded, activeIndex, listId])

  const accessibility = {
    id,
    role: 'combobox',
    'aria-label': props['aria-label'],
    'aria-labelledby': props['aria-labelledby'],
    'aria-expanded': expanded,
    'aria-controls': expanded ? listId : undefined,
    'aria-haspopup': 'listbox' as const,
    'aria-activedescendant': expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined,
    'aria-required': required || undefined,
    'aria-invalid': invalid || undefined
  }
  return (
    <div ref={root} className={`tm-picker ${compact ? 'tm-picker--compact' : ''} ${className}`}>
      {props.editable ? (
        <div className="tm-picker-editable">
          <input
            {...accessibility}
            ref={(node) => {
              trigger.current = node
            }}
            className="tm-picker-trigger"
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            disabled={disabled}
            required={required}
            title={title}
            placeholder={placeholder}
            value={props.value}
            onChange={(event) => {
              props.onChange(event.target.value)
              setInvalid(false)
              setActiveValue(null)
              setOpen(true)
            }}
            onClick={() => show()}
            onKeyDown={handleKeyDown}
          />
          <button
            className="tm-picker-toggle"
            type="button"
            disabled={disabled}
            aria-label={`Show ${props['aria-label'] ?? 'options'}`}
            tabIndex={-1}
            onClick={() => {
              trigger.current?.focus()
              if (expanded) setOpen(false)
              else show()
            }}
          >
            <ChevronDownIcon width={12} height={12} />
          </button>
        </div>
      ) : (
        <button
          {...accessibility}
          ref={(node) => {
            trigger.current = node
          }}
          type="button"
          className="tm-picker-trigger"
          disabled={disabled}
          title={title}
          value={Array.isArray(props.value) ? props.value.join(',') : props.value}
          onKeyDown={handleKeyDown}
          onClick={() => {
            if (expanded) setOpen(false)
            else show()
          }}
        >
          {selected.length === 1 && selected[0].icon ? (
            <span className="tm-picker-icon">{selected[0].icon}</span>
          ) : null}
          <span className="tm-picker-label">{label}</span>
          <ChevronDownIcon className="tm-picker-chevron" width={12} height={12} />
        </button>
      )}
      {required && !props.editable ? (
        <input
          tabIndex={-1}
          aria-hidden="true"
          className="tm-picker-validation"
          required
          disabled={disabled}
          value={values.some(Boolean) ? 'selected' : ''}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault()
            setInvalid(true)
            trigger.current?.focus()
          }}
        />
      ) : null}
      {invalid ? (
        <span className="tm-picker-error" role="alert">
          Choose an option.
        </span>
      ) : null}
      {expanded
        ? createPortal(
            <div ref={popup} className="tm-picker-popup" style={position}>
              <div
                id={listId}
                role="listbox"
                aria-label={props['aria-label']}
                aria-labelledby={props['aria-labelledby']}
                aria-multiselectable={props.multiple || undefined}
              >
                {visibleOptions.map((option, index) => (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-label={option.label}
                    aria-selected={values.includes(option.value)}
                    aria-disabled={option.disabled || undefined}
                    data-highlighted={activeIndex === index}
                    className="tm-picker-option"
                    onPointerDown={(event) => event.preventDefault()}
                    title={option.description}
                    onPointerMove={() => {
                      if (!option.disabled) setActiveValue(option.value)
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      choose(option)
                    }}
                  >
                    {option.icon ? <span className="tm-picker-icon">{option.icon}</span> : null}
                    <span className="tm-picker-option-text">
                      <span className="tm-picker-label">{option.label}</span>
                      {option.description ? (
                        <span className="tm-picker-description">{option.description}</span>
                      ) : null}
                    </span>
                    <span className="tm-picker-check" aria-hidden="true">
                      {values.includes(option.value) ? '✓' : ''}
                    </span>
                  </div>
                ))}
                {!visibleOptions.length ? (
                  <div className="tm-picker-empty">
                    {props.editable
                      ? 'No matches. Use a new branch name.'
                      : 'No options available.'}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
