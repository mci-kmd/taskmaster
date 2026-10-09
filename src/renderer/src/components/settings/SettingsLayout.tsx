import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { CheckIcon } from '../Icons'
import Checkbox from '../ui/Checkbox'
import { TextArea, TextInput } from '../ui/Field'
import type { AutoSaveField, AutoSaveFieldStatus, AutoSaveStatus } from './use-auto-save'

export type SettingsSection = {
  id: string
  label: string
  description?: string
  /** Marks the section in the navigation when one of its fields failed to save. */
  hasError?: boolean
  tone?: 'danger'
  content: ReactNode
}

type SettingsLayoutProps = {
  /** Accessible name of the section navigation. */
  label: string
  sections: SettingsSection[]
  activeId: string
  onActiveChange: (id: string) => void
}

/** Settings pane with a vertical section navigation (tabs) and a scrollable content area. */
export function SettingsLayout({
  label,
  sections,
  activeId,
  onActiveChange
}: SettingsLayoutProps): React.JSX.Element {
  const idPrefix = useId()
  const tabs = useRef(new Map<string, HTMLButtonElement>())
  const active = sections.find((section) => section.id === activeId) ?? sections[0]
  const tabId = (id: string): string => `${idPrefix}-tab-${id}`
  const panelId = `${idPrefix}-panel`

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = sections.findIndex((section) => section.id === active.id)
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % sections.length
        : event.key === 'ArrowUp'
          ? (index - 1 + sections.length) % sections.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? sections.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    const target = sections[next]
    onActiveChange(target.id)
    tabs.current.get(target.id)?.focus()
  }

  return (
    <>
      <div
        aria-label={label}
        aria-orientation="vertical"
        className="flex w-[184px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] p-2"
        onKeyDown={handleKeyDown}
        role="tablist"
      >
        {sections.map((section) => {
          const selected = section.id === active.id
          return (
            <button
              aria-controls={panelId}
              aria-selected={selected}
              autoFocus={selected}
              className="tm-settings-nav-item"
              data-tone={section.tone}
              id={tabId(section.id)}
              key={section.id}
              onClick={() => onActiveChange(section.id)}
              ref={(node) => {
                if (node) tabs.current.set(section.id, node)
                else tabs.current.delete(section.id)
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{section.label}</span>
              {section.hasError ? (
                <span
                  aria-label="Has unsaved changes"
                  className="size-1.5 shrink-0 rounded-full bg-[var(--color-danger)]"
                  role="img"
                />
              ) : null}
            </button>
          )
        })}
      </div>
      <div
        aria-labelledby={tabId(active.id)}
        className="min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-5"
        id={panelId}
        key={active.id}
        role="tabpanel"
      >
        <SettingsSectionBody section={active} />
      </div>
    </>
  )
}

/** A section's heading, description and rows; also used on its own for single-section dialogs. */
export function SettingsSectionBody({
  section,
  showHeading = true
}: {
  section: Pick<SettingsSection, 'label' | 'description' | 'content'>
  showHeading?: boolean
}): React.JSX.Element {
  return (
    <>
      {showHeading ? (
        <header className="mb-1">
          <h3 className="text-[14px] font-medium tracking-tight text-[var(--color-fg)]">
            {section.label}
          </h3>
          {section.description ? (
            <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
              {section.description}
            </p>
          ) : null}
        </header>
      ) : null}
      <div className="divide-y divide-[var(--color-border)]">{section.content}</div>
    </>
  )
}

/** Global auto-save status, announced politely to assistive technology. */
export function SaveStatus({
  status,
  errorCount
}: {
  status: AutoSaveStatus
  errorCount: number
}): React.JSX.Element {
  return (
    <span
      aria-live="polite"
      className="tm-save-status"
      data-status={status}
      role="status"
      title="Changes are saved automatically"
    >
      {status === 'saving' ? (
        'Saving…'
      ) : status === 'saved' ? (
        <>
          <CheckIcon aria-hidden height={12} width={12} />
          Saved
        </>
      ) : status === 'error' ? (
        `${errorCount} ${errorCount === 1 ? 'change' : 'changes'} not saved`
      ) : (
        'Changes save automatically'
      )}
    </span>
  )
}

function FieldStatusBadge({ status }: { status: AutoSaveFieldStatus }): React.JSX.Element | null {
  if (status.state === 'saving') {
    return (
      <span aria-hidden className="tm-field-status">
        Saving…
      </span>
    )
  }
  if (status.state === 'saved') {
    return (
      <span aria-hidden className="tm-field-status" data-state="saved">
        <CheckIcon height={11} width={11} />
        Saved
      </span>
    )
  }
  return null
}

type SettingRowProps = {
  label: string
  hint?: ReactNode
  /** Id of the row's control; the hint and error ids derive from it. */
  controlId?: string
  /**
   * Whether the row label labels the control. Turn off for controls with their own label
   * (checkboxes); the row label then gets labelId, e.g. for a group's aria-labelledby.
   */
  labelsControl?: boolean
  labelId?: string
  status?: AutoSaveFieldStatus
  /** Puts the control below the label instead of beside it; for wide controls. */
  stacked?: boolean
  children: ReactNode
}

function hintId(controlId: string): string {
  return `${controlId}-hint`
}

function errorId(controlId: string): string {
  return `${controlId}-error`
}

/** aria-describedby for a field's control: its hint, plus its error when saving failed. */
function describedBy(
  field: Pick<AutoSaveField<unknown>, 'id' | 'status'>,
  hasHint: boolean
): string | undefined {
  const ids = [
    hasHint ? hintId(field.id) : null,
    field.status.state === 'error' ? errorId(field.id) : null
  ].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}

/** A labelled settings row: label and hint on the left, the control on the right. */
export function SettingRow({
  label,
  hint,
  controlId,
  labelsControl = true,
  labelId,
  status,
  stacked = false,
  children
}: SettingRowProps): React.JSX.Element {
  const labelClass = 'text-[13px] font-medium text-[var(--color-fg)]'
  return (
    <div className="tm-setting-row" data-stacked={stacked || undefined}>
      <div className="tm-setting-row__meta">
        <div className="flex min-h-5 items-center gap-2">
          {controlId && labelsControl ? (
            <label className={labelClass} htmlFor={controlId}>
              {label}
            </label>
          ) : (
            <span className={labelClass} id={labelId}>
              {label}
            </span>
          )}
          {status ? <FieldStatusBadge status={status} /> : null}
        </div>
        {hint ? (
          <p
            className="mt-0.5 text-[12px] leading-[18px] text-[var(--color-fg-subtle)]"
            id={controlId ? hintId(controlId) : undefined}
          >
            {hint}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">
        {children}
        {status?.state === 'error' ? (
          <p
            className="mt-1.5 text-[12px] leading-[18px] text-[var(--color-danger)]"
            id={controlId ? errorId(controlId) : undefined}
          >
            {status.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

type TextSettingProps = {
  field: AutoSaveField<string>
  label: string
  hint?: ReactNode
  placeholder?: string
  /** Extra control beside the input, e.g. a Browse button. */
  action?: ReactNode
  autoFocus?: boolean
  maxLength?: number
  stacked?: boolean
  children?: ReactNode
}

/** Single-line text setting; saves after a pause in typing, on blur and on Enter. */
export function TextSetting({
  field,
  label,
  hint,
  placeholder,
  action,
  autoFocus,
  maxLength,
  stacked,
  children
}: TextSettingProps): React.JSX.Element {
  return (
    <SettingRow
      controlId={field.id}
      hint={hint}
      label={label}
      stacked={stacked}
      status={field.status}
    >
      <div className="flex items-center gap-2">
        <TextInput
          aria-describedby={describedBy(field, Boolean(hint))}
          aria-invalid={field.status.state === 'error' || undefined}
          autoFocus={autoFocus}
          className="min-w-0 flex-1"
          id={field.id}
          maxLength={maxLength}
          onBlur={field.commit}
          onChange={(event) => field.edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              field.commit()
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          value={field.value}
        />
        {action}
      </div>
      {children}
    </SettingRow>
  )
}

type TextAreaSettingProps = {
  field: AutoSaveField<string>
  label: string
  hint?: ReactNode
  placeholder?: string
  rows?: number
  children?: ReactNode
}

/** Multi-line (monospace) text setting, shown below its label; saves like TextSetting. */
export function TextAreaSetting({
  field,
  label,
  hint,
  placeholder,
  rows = 4,
  children
}: TextAreaSettingProps): React.JSX.Element {
  return (
    <SettingRow controlId={field.id} hint={hint} label={label} stacked status={field.status}>
      <TextArea
        aria-describedby={describedBy(field, Boolean(hint))}
        aria-invalid={field.status.state === 'error' || undefined}
        className="tm-input--mono min-h-0 min-w-0 w-full"
        id={field.id}
        onBlur={field.commit}
        onChange={(event) => field.edit(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        value={field.value}
      />
      {children}
    </SettingRow>
  )
}

type CheckboxSettingProps = {
  field: AutoSaveField<boolean>
  label: string
  hint?: ReactNode
  /** The checkbox's own label; also its accessible name. */
  checkboxLabel: string
}

/** Boolean setting; saves as soon as it is toggled. */
export function CheckboxSetting({
  field,
  label,
  hint,
  checkboxLabel
}: CheckboxSettingProps): React.JSX.Element {
  return (
    <SettingRow
      controlId={field.id}
      hint={hint}
      label={label}
      labelsControl={false}
      status={field.status}
    >
      <Checkbox
        aria-describedby={describedBy(field, Boolean(hint))}
        checked={field.value}
        id={field.id}
        label={checkboxLabel}
        onChange={field.set}
      />
    </SettingRow>
  )
}

/** Read-only chips previewing parsed task tags. */
export function TagPreview({
  tags,
  empty
}: {
  tags: readonly string[]
  empty?: string
}): React.JSX.Element | null {
  if (!tags.length) {
    return empty ? <p className="mt-2 text-[12px] text-[var(--color-fg-subtle)]">{empty}</p> : null
  }
  return (
    <ul aria-label="Tag preview" className="mt-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-0.5 text-[11.5px] text-[var(--color-fg)]"
          key={tag}
        >
          {tag}
        </li>
      ))}
    </ul>
  )
}

/** Inline code token for hints, e.g. a run command placeholder. */
export function Token({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <code className="rounded bg-[var(--color-input)] px-1 py-px font-mono text-[11px] text-[var(--color-fg-muted)]">
      {children}
    </code>
  )
}
