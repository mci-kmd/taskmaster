import { useLayoutEffect, useRef } from 'react'

type Option<T extends string> = {
  value: T
  label: string
  description?: string
  /** Keeps the option focusable so its description still explains why it is unavailable. */
  disabled?: boolean
}

type SegmentedControlProps<T extends string> = {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
}

export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: SegmentedControlProps<T>): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  // The thumb slides between options, but jumps into place when it first appears or resizes.
  const placed = useRef(false)

  useLayoutEffect(() => {
    const element = track.current
    if (!element) return
    const place = (instant: boolean): void => {
      const active = element.querySelector<HTMLElement>('[data-active="true"]')
      const indicator = thumb.current
      if (!indicator) return
      indicator.toggleAttribute('data-instant', instant)
      indicator.style.opacity = active ? '1' : '0'
      if (!active) return
      element.style.setProperty('--tm-thumb-x', `${active.offsetLeft}px`)
      element.style.setProperty('--tm-thumb-width', `${active.offsetWidth}px`)
    }
    place(!placed.current)
    placed.current = true
    if (typeof ResizeObserver === 'undefined') return
    // Observing reports the current size once; only real resizes should re-place the thumb.
    let width = element.offsetWidth
    const observer = new ResizeObserver(() => {
      if (element.offsetWidth === width) return
      width = element.offsetWidth
      place(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [value, options.length])

  return (
    <div aria-label={ariaLabel} className="tm-segmented" ref={track} role="radiogroup">
      <span aria-hidden="true" className="tm-segmented__thumb" ref={thumb} />
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            aria-checked={active}
            aria-disabled={option.disabled || undefined}
            className="tm-segmented__option"
            data-active={active}
            key={option.value}
            onClick={() => {
              if (!option.disabled) onChange(option.value)
            }}
            role="radio"
            title={option.description ?? option.label}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
