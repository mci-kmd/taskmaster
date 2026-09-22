import Select from '../ui/Select'
import { useState } from 'react'
import type { CopilotInteraction, CopilotInteractionResponse } from '../../../../shared/app-types'
import Button from '../ui/Button'
import SessionMarkdown from './SessionMarkdown'
import { safeExternalUrl } from './safe-external-url'

export default function InteractionPanel({
  interaction,
  threadId,
  onRespond,
  busy
}: {
  interaction: CopilotInteraction
  threadId: string
  busy: boolean
  onRespond: (response: CopilotInteractionResponse) => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>(() =>
    Object.fromEntries(
      Object.entries(
        interaction.kind === 'elicitation' ? (interaction.schema?.properties ?? {}) : {}
      )
        .filter(([, field]) => field.default !== undefined || field.type === 'boolean')
        .map(([name, field]) => [name, field.default ?? false])
    )
  )

  if (interaction.kind === 'permission') {
    return (
      <fieldset disabled={busy} className="min-w-0 p-4">
        <div className="text-[12.5px] font-medium text-[var(--color-warning)]">
          {interaction.title}
        </div>
        <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-[var(--color-fg-muted)]">
          {interaction.description}
        </pre>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            onClick={() =>
              onRespond({
                threadId,
                interactionId: interaction.id,
                action: 'reject'
              })
            }
            size="sm"
            variant="ghost"
          >
            Reject
          </Button>
          {interaction.allowSessionApproval ? (
            <Button
              onClick={() =>
                onRespond({
                  threadId,
                  interactionId: interaction.id,
                  action: 'approve-session'
                })
              }
              size="sm"
              variant="secondary"
            >
              Allow for session
            </Button>
          ) : null}
          <Button
            onClick={() =>
              onRespond({
                threadId,
                interactionId: interaction.id,
                action: 'approve-once'
              })
            }
            size="sm"
            variant="primary"
          >
            Allow once
          </Button>
        </div>
      </fieldset>
    )
  }

  if (interaction.kind === 'user-input') {
    return (
      <fieldset disabled={busy} className="min-w-0 p-4">
        <div className="mb-2 text-[12.5px] font-medium">{interaction.title}</div>
        <SessionMarkdown>{interaction.description}</SessionMarkdown>
        <div className="mt-3 flex flex-wrap gap-2">
          {interaction.choices.map((choice) => (
            <Button
              key={choice}
              onClick={() =>
                onRespond({
                  threadId,
                  interactionId: interaction.id,
                  action: 'accept',
                  value: choice,
                  wasFreeform: false
                })
              }
              size="sm"
              variant="secondary"
            >
              {choice}
            </Button>
          ))}
        </div>
        {interaction.allowFreeform ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!value.trim()) return
              onRespond({
                threadId,
                interactionId: interaction.id,
                action: 'accept',
                value: value.trim(),
                wasFreeform: true
              })
            }}
          >
            <input
              aria-label="Your answer"
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[12.5px]"
              onChange={(event) => setValue(event.target.value)}
              placeholder="Type an answer"
              value={value}
            />
            <Button disabled={!value.trim()} size="sm" type="submit" variant="primary">
              Answer
            </Button>
          </form>
        ) : null}
        <Button
          className="mt-3"
          size="sm"
          variant="ghost"
          onClick={() => onRespond({ threadId, interactionId: interaction.id, action: 'cancel' })}
        >
          Cancel
        </Button>
      </fieldset>
    )
  }

  const fields = Object.entries(interaction.schema?.properties ?? {})
  return (
    <form
      className="border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        onRespond({
          threadId,
          interactionId: interaction.id,
          action: 'accept',
          values
        })
      }}
    >
      <fieldset disabled={busy} className="min-w-0">
        <div className="mb-2 text-[12.5px] font-medium">{interaction.title}</div>
        <SessionMarkdown>{interaction.description}</SessionMarkdown>
        {interaction.mode === 'url' && interaction.url ? (
          <Button
            disabled={!safeExternalUrl(interaction.url)}
            className="mt-3"
            onClick={() => window.open(safeExternalUrl(interaction.url), '_blank')}
            size="sm"
            type="button"
            variant="secondary"
          >
            Open sign-in page
          </Button>
        ) : (
          <div className="mt-3 grid gap-3">
            {fields.map(([name, field]) => (
              <label className="grid gap-1.5" key={name}>
                <span className="text-[11.5px] text-[var(--color-fg-muted)]">
                  {field.title ?? name}
                </span>
                {field.type === 'boolean' ? (
                  <input
                    checked={Boolean(values[name] ?? field.default)}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [name]: event.target.checked }))
                    }
                    type="checkbox"
                  />
                ) : field.options ? (
                  field.type === 'array' ? (
                    <Select
                      multiple
                      aria-label={field.title ?? name}
                      disabled={busy}
                      required={interaction.schema?.required.includes(name)}
                      options={field.options.map((option) => ({ value: option, label: option }))}
                      value={(values[name] as string[] | undefined) ?? []}
                      onChange={(next) => setValues((current) => ({ ...current, [name]: next }))}
                    />
                  ) : (
                    <Select
                      aria-label={field.title ?? name}
                      disabled={busy}
                      required={interaction.schema?.required.includes(name)}
                      options={[
                        { value: '', label: 'Select' },
                        ...field.options.map((option) => ({ value: option, label: option }))
                      ]}
                      value={String(values[name] ?? field.default ?? '')}
                      onChange={(next) => setValues((current) => ({ ...current, [name]: next }))}
                    />
                  )
                ) : (
                  <input
                    className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[12.5px]"
                    defaultValue={String(field.default ?? '')}
                    onChange={(event) =>
                      setValues((current) => {
                        const next = { ...current }
                        if (event.target.value === '') delete next[name]
                        else
                          next[name] =
                            field.type === 'number' || field.type === 'integer'
                              ? Number(event.target.value)
                              : event.target.value
                        return next
                      })
                    }
                    step={field.type === 'number' ? 'any' : undefined}
                    required={interaction.schema?.required.includes(name)}
                    type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                  />
                )}
                {field.description ? (
                  <span className="text-[10.5px] text-[var(--color-fg-subtle)]">
                    {field.description}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button
            onClick={() =>
              onRespond({
                threadId,
                interactionId: interaction.id,
                action: 'cancel'
              })
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button size="sm" type="submit" variant="primary">
            Continue
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
