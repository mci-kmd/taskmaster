import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { CopilotModelOption } from '../../../../shared/app-types'
import { ChevronDownIcon, ChevronRightIcon, StarIcon } from '../Icons'
import { modelFamily } from './model-families'
import { useLastValue, usePresence } from '../../lib/motion'

type ModelChoice = CopilotModelOption & { disabled?: boolean }
type TopItem =
  | { key: string; kind: 'family'; name: string }
  | { key: string; kind: 'favorite'; model: ModelChoice }

type SubItem = { kind: 'model'; model: ModelChoice } | { kind: 'legacy' }

/** Key of the row that shows or hides a family's legacy models. */
const LEGACY_KEY = '\u0000legacy'
const familyKey = (name: string): string => `family:${name}`
const favoriteKey = (id: string): string => `favorite:${id}`
const topLabel = (item: TopItem): string => (item.kind === 'family' ? item.name : item.model.name)

export default function ModelPicker({
  models: catalog,
  value,
  disabled,
  placeholder,
  favorites = [],
  legacyModels = [],
  onChange,
  onToggleFavorite
}: {
  models: CopilotModelOption[]
  value: string
  disabled: boolean
  placeholder: string
  /** Starred model ids, in the order they appear at the bottom of the menu. */
  favorites?: string[]
  /** Model ids listed under a collapsed Legacy row at the end of their family. */
  legacyModels?: string[]
  onChange: (id: string) => void
  onToggleFavorite?: (id: string, favorite: boolean) => void
}): React.JSX.Element {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const submenu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null)
  /** A model id, or LEGACY_KEY for the Legacy row. */
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const search = useRef({ text: '', time: 0 })
  // Hover must not scroll the menus; only keyboard/open navigation reveals the highlight.
  const pointerNavigation = useRef(false)
  const seen = new Set<string>()
  // Duplicate ids break React keys and highlight lookup, so keep the first entry.
  const models = catalog.filter((model) => {
    if (seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
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
  const favoriteSet = new Set(favorites)
  const favoriteModels = favorites.flatMap((favorite) => {
    const model = models.find((item) => item.id === favorite)
    return model ? [model] : []
  })
  const topItems: TopItem[] = [
    ...families.map((name) => ({ key: familyKey(name), kind: 'family' as const, name })),
    ...favoriteModels.map((model) => ({
      key: favoriteKey(model.id),
      kind: 'favorite' as const,
      model
    }))
  ]
  const highlighted = topItems.find((item) => item.key === highlight) ?? null
  const legacySet = new Set(legacyModels)
  const isLegacy = (model: ModelChoice): boolean => legacySet.has(model.id)
  const visible = open && !disabled
  const presence = usePresence(visible)
  const submenuPresence = usePresence(visible && expandedFamily !== null)
  // A collapsing submenu keeps showing its family while it animates out.
  const lastFamily = useLastValue(expandedFamily)
  const shownFamily = submenuPresence.mounted ? lastFamily : null
  const familyModels = shownFamily ? (groups.get(shownFamily) ?? []) : []
  const legacyChoices = familyModels.filter(isLegacy)
  const subItems: SubItem[] = [
    ...familyModels
      .filter((model) => !isLegacy(model))
      .map((model) => ({ kind: 'model' as const, model })),
    ...(legacyChoices.length ? [{ kind: 'legacy' as const }] : []),
    ...(legacyOpen ? legacyChoices.map((model) => ({ kind: 'model' as const, model })) : [])
  ]
  const subKey = (item: SubItem): string => (item.kind === 'legacy' ? LEGACY_KEY : item.model.id)
  // Models shown in the submenu, excluding hidden legacy ones.
  const choices = subItems.flatMap((item) => (item.kind === 'model' ? [item.model] : []))
  const enabled = choices.filter((model) => !model.disabled)
  const navigable = subItems
    .filter((item) => item.kind === 'legacy' || !item.model.disabled)
    .map(subKey)
  const topId = (key: string): string =>
    `${id}-top-${topItems.findIndex((item) => item.key === key)}`
  const modelId = (key: string): string =>
    `${id}-model-${subItems.findIndex((item) => subKey(item) === key)}`

  function show(): void {
    pointerNavigation.current = false
    setOpen(true)
    setHighlight(selected ? familyKey(modelFamily(selected)) : (topItems[0]?.key ?? null))
    setExpandedFamily(null)
    setActiveModel(null)
    search.current = { text: '', time: 0 }
  }
  function expand(name: string, keyboard = false): void {
    setHighlight(familyKey(name))
    setExpandedFamily(name)
    const items = groups.get(name) ?? []
    // Reveal legacy models when the current model is one of them.
    setLegacyOpen(items.some((item) => item.id === value && legacySet.has(item.id)))
    setActiveModel(
      keyboard
        ? (items.find((item) => item.id === value && !item.disabled)?.id ??
            items.find((item) => !item.disabled && !legacySet.has(item.id))?.id ??
            (items.some((item) => legacySet.has(item.id)) ? LEGACY_KEY : null))
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
  function toggleFavorite(model: ModelChoice): void {
    if (!onToggleFavorite || model.disabled) return
    const favorite = !favoriteSet.has(model.id)
    if (!favorite && highlight === favoriteKey(model.id)) {
      const index = topItems.findIndex((item) => item.key === highlight)
      setHighlight(topItems[index - 1]?.key ?? topItems[index + 1]?.key ?? null)
    }
    onToggleFavorite(model.id, favorite)
  }
  function keyDown(event: KeyboardEvent): void {
    if (disabled || event.nativeEvent.isComposing) return
    pointerNavigation.current = false
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
    if (event.key === '*' && visible) {
      event.preventDefault()
      const model =
        activeModel !== null
          ? choices.find((item) => item.id === activeModel)
          : highlighted?.kind === 'favorite'
            ? highlighted.model
            : undefined
      if (model) toggleFavorite(model)
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
        if (activeModel === LEGACY_KEY) setLegacyOpen(true)
        else if (highlighted?.kind === 'family' && activeModel === null)
          expand(highlighted.name, true)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (activeModel === LEGACY_KEY) {
          setLegacyOpen((current) => !current)
          return
        }
        const model = choices.find((item) => item.id === activeModel)
        if (model) choose(model)
        else if (highlighted?.kind === 'favorite') choose(highlighted.model)
        else if (highlighted) expand(highlighted.name, true)
        return
      }
      const inModels = activeModel !== null
      const items = inModels ? navigable : topItems.map((item) => item.key)
      const current = items.indexOf(inModels ? activeModel! : (highlight ?? ''))
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      if (inModels) setActiveModel(items[next] ?? null)
      else {
        setHighlight(items[next] ?? null)
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
        const match = topItems.find((item) =>
          topLabel(item).toLowerCase().startsWith(text.toLowerCase())
        )
        if (match) {
          setHighlight(match.key)
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
      const upwards = bounds.bottom + 4 + height > window.innerHeight - 8
      root.style.top = `${Math.max(8, Math.min(upwards ? bounds.top - height - 4 : bounds.bottom + 4, window.innerHeight - height - 8))}px`
      root.dataset.placement = upwards ? 'top' : 'bottom'
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
  }, [visible, expandedFamily, models.length, favoriteModels.length, legacyOpen])

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
    if (visible && !pointerNavigation.current)
      (activeModel ? submenu : menu).current
        ?.querySelector('[data-highlighted="true"]')
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [visible, highlight, activeModel])

  const star = (model: ModelChoice): React.JSX.Element | null => {
    if (!onToggleFavorite || model.disabled) return null
    const favorite = favoriteSet.has(model.id)
    return (
      <button
        type="button"
        tabIndex={-1}
        className="tm-picker-star"
        aria-pressed={favorite}
        aria-label={
          favorite ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`
        }
        title={favorite ? 'Remove from favorites (*)' : 'Add to favorites (*)'}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation()
          toggleFavorite(model)
        }}
      >
        <StarIcon filled={favorite} width={13} height={13} />
      </button>
    )
  }

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
              : highlighted
                ? topId(highlighted.key)
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
      {presence.mounted &&
        createPortal(
          <>
            <div
              ref={menu}
              id={`${id}-tree`}
              role="tree"
              aria-label="Model families"
              className="tm-picker-popup"
              data-motion="drop"
              data-state={presence.state}
              style={{ position: 'fixed', visibility: 'hidden' }}
            >
              {families.map((name) => (
                <div
                  key={name}
                  id={topId(familyKey(name))}
                  role="treeitem"
                  aria-label={name}
                  aria-expanded={expandedFamily === name}
                  aria-owns={expandedFamily === name ? `${id}-children` : undefined}
                  className="tm-picker-option"
                  data-highlighted={highlight === familyKey(name)}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => {
                    pointerNavigation.current = true
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
              {favoriteModels.length > 0 && (
                <div role="group" aria-label="Favorites" className="tm-picker-favorites">
                  <div className="tm-picker-group-label" aria-hidden="true">
                    Favorites
                  </div>
                  {favoriteModels.map((model) => (
                    <div
                      key={model.id}
                      id={topId(favoriteKey(model.id))}
                      role="treeitem"
                      aria-label={model.name}
                      aria-selected={model.id === value}
                      className="tm-picker-option"
                      data-highlighted={highlight === favoriteKey(model.id)}
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerMove={() => {
                        pointerNavigation.current = true
                        if (highlight !== favoriteKey(model.id) || expandedFamily) {
                          setHighlight(favoriteKey(model.id))
                          collapse()
                        }
                      }}
                      onClick={() => choose(model)}
                    >
                      <span className="tm-picker-option-text">
                        <span className="tm-picker-label">{model.name}</span>
                      </span>
                      <span className="tm-picker-check" aria-hidden="true">
                        {model.id === value ? '✓' : ''}
                      </span>
                      {star(model)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {shownFamily && (
              <div
                // Re-keyed per family so switching families replays the entrance.
                key={shownFamily}
                ref={submenu}
                id={`${id}-children`}
                role="group"
                aria-label={`${shownFamily} models`}
                className="tm-picker-popup"
                data-motion="drop"
                data-state={submenuPresence.state}
                style={{ position: 'fixed', visibility: 'hidden' }}
              >
                {subItems.map((item) => {
                  if (item.kind === 'legacy')
                    return (
                      <div
                        key={LEGACY_KEY}
                        id={modelId(LEGACY_KEY)}
                        role="treeitem"
                        aria-label="Legacy"
                        aria-level={2}
                        aria-expanded={legacyOpen}
                        className="tm-picker-option tm-picker-legacy"
                        data-highlighted={activeModel === LEGACY_KEY}
                        onPointerDown={(event) => event.preventDefault()}
                        onPointerMove={() => {
                          pointerNavigation.current = true
                          setActiveModel(LEGACY_KEY)
                        }}
                        onClick={() => setLegacyOpen((current) => !current)}
                      >
                        <span className="tm-picker-option-text">
                          <span className="tm-picker-label">Legacy</span>
                        </span>
                        <span className="tm-picker-legacy-count" aria-hidden="true">
                          {legacyChoices.length}
                        </span>
                        <ChevronRightIcon
                          className="tm-picker-legacy-chevron"
                          data-expanded={legacyOpen}
                          width={12}
                          height={12}
                        />
                      </div>
                    )
                  const { model } = item
                  return (
                    <div
                      key={model.id}
                      id={modelId(model.id)}
                      role="treeitem"
                      aria-label={model.name}
                      aria-level={isLegacy(model) ? 3 : 2}
                      aria-selected={model.id === value}
                      aria-disabled={model.disabled || undefined}
                      className={
                        isLegacy(model)
                          ? 'tm-picker-option tm-picker-option--legacy'
                          : 'tm-picker-option'
                      }
                      data-highlighted={activeModel === model.id}
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerMove={() => {
                        pointerNavigation.current = true
                        if (!model.disabled) setActiveModel(model.id)
                      }}
                      onClick={() => choose(model)}
                    >
                      <span className="tm-picker-option-text">
                        <span className="tm-picker-label">{model.name}</span>
                      </span>
                      <span className="tm-picker-check" aria-hidden="true">
                        {model.id === value ? '✓' : ''}
                      </span>
                      {star(model)}
                    </div>
                  )
                })}
              </div>
            )}
          </>,
          document.body
        )}
    </div>
  )
}
