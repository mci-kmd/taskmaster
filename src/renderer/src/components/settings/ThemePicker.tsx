import { useRef, type KeyboardEvent } from 'react'
import { THEMES, type ThemeId } from '../../../../shared/themes'
import { CheckIcon } from '../Icons'

type ThemePickerProps = {
  value: ThemeId
  onChange: (theme: ThemeId) => void
  /** Id of the element that names the group. */
  labelledBy?: string
  describedBy?: string
}

/**
 * Theme cards in a radio group. Each card previews the app in its theme: the preview carries
 * its own data-theme, so the tokens inside it resolve to that theme's values.
 */
export default function ThemePicker({
  value,
  onChange,
  labelledBy,
  describedBy
}: ThemePickerProps): React.JSX.Element {
  const cards = useRef(new Map<ThemeId, HTMLButtonElement>())

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = THEMES.findIndex((theme) => theme.id === value)
    const last = THEMES.length - 1
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index <= 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    const target = THEMES[next].id
    onChange(target)
    cards.current.get(target)?.focus()
  }

  return (
    <div
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
      className="tm-theme-picker"
      onKeyDown={handleKeyDown}
      role="radiogroup"
    >
      {THEMES.map((theme) => {
        const selected = theme.id === value
        return (
          <button
            aria-checked={selected}
            className="tm-theme-card"
            key={theme.id}
            onClick={() => onChange(theme.id)}
            ref={(node) => {
              if (node) cards.current.set(theme.id, node)
              else cards.current.delete(theme.id)
            }}
            role="radio"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            <ThemePreview theme={theme.id} />
            <span className="tm-theme-card__text">
              <span className="tm-theme-card__label">{theme.label}</span>
              <span className="tm-theme-card__description">{theme.description}</span>
            </span>
            <span aria-hidden className="tm-theme-card__check">
              <CheckIcon height={10} width={10} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** A static miniature of the app: sidebar with a selected thread, and the workspace card. */
export function ThemePreview({ theme }: { theme: ThemeId }): React.JSX.Element {
  return (
    <span aria-hidden className="tm-theme-preview" data-theme={theme}>
      <span className="tm-theme-preview__sidebar">
        <span className="tm-theme-preview__logo" />
        <span className="tm-theme-preview__row">
          <span className="tm-theme-preview__line" style={{ width: '70%' }} />
        </span>
        <span className="tm-theme-preview__row" data-selected>
          <span className="tm-theme-preview__line" style={{ width: '82%' }} />
          <span className="tm-theme-preview__line" data-faint style={{ width: '50%' }} />
        </span>
        <span className="tm-theme-preview__row">
          <span className="tm-theme-preview__line" style={{ width: '60%' }} />
        </span>
      </span>
      <span className="tm-theme-preview__workspace">
        <span className="tm-theme-preview__bubble" />
        <span className="tm-theme-preview__line" style={{ width: '88%' }} />
        <span className="tm-theme-preview__line" style={{ width: '72%' }} />
        <span className="tm-theme-preview__line" data-faint style={{ width: '54%' }} />
        <span className="tm-theme-preview__composer">
          <span className="tm-theme-preview__send" />
        </span>
      </span>
    </span>
  )
}
