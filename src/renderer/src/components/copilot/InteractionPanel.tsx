import { useState } from 'react'
import type { CopilotInteraction, CopilotInteractionResponse } from '../../../../shared/app-types'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import { TextInput } from '../ui/Field'
import Presence from '../ui/Presence'
import { QuestionIcon } from '../Icons'
import ChoiceList from './ChoiceList'
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
      <fieldset disabled={busy} className="tm-session-request-body">
        <RequestTitle>{interaction.title}</RequestTitle>
        <pre className="tm-session-request-command">{interaction.description}</pre>
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
          <Presence show={interaction.allowSessionApproval} motion="fade">
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
          </Presence>
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
      <fieldset disabled={busy} className="tm-session-request-body">
        <RequestTitle>{interaction.title}</RequestTitle>
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
        <Presence show={interaction.allowFreeform} motion="collapse">
          <form
            className="flex gap-2 pt-3"
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
            <TextInput
              aria-label="Your answer"
              autoFocus
              className="min-w-0 flex-1"
              onChange={(event) => setValue(event.target.value)}
              placeholder="Type an answer"
              value={value}
            />
            <Button disabled={!value.trim()} size="md" type="submit" variant="primary">
              Answer
            </Button>
          </form>
        </Presence>
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
  const setField = (name: string, next: string | string[] | undefined): void =>
    setValues((current) => {
      const updated = { ...current }
      if (next === undefined) delete updated[name]
      else updated[name] = next
      return updated
    })
  return (
    <form
      className="tm-session-request-body"
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
        <RequestTitle>{interaction.title}</RequestTitle>
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
            {fields.map(([name, field]) =>
              field.type === 'boolean' ? (
                <div className="py-0.5" key={name}>
                  <Checkbox
                    checked={Boolean(values[name] ?? field.default)}
                    disabled={busy}
                    label={
                      <span className="flex flex-col gap-0.5">
                        <span>{field.title ?? name}</span>
                        <Presence show={Boolean(field.description)} motion="fade">
                          <span className="tm-session-request-hint">{field.description}</span>
                        </Presence>
                      </span>
                    }
                    onChange={(checked) =>
                      setValues((current) => ({ ...current, [name]: checked }))
                    }
                  />
                </div>
              ) : field.options ? (
                <div className="grid gap-1.5" key={name}>
                  <span className="tm-session-request-label">{field.title ?? name}</span>
                  {field.type === 'array' ? (
                    <ChoiceList
                      multiple
                      allowOther={Boolean(interaction.allowFreeform)}
                      label={field.title ?? name}
                      onChange={(next) => setField(name, next.length ? next : undefined)}
                      options={field.options}
                      required={Boolean(interaction.schema?.required.includes(name))}
                      value={(values[name] as string[] | undefined) ?? []}
                    />
                  ) : (
                    <ChoiceList
                      allowOther={Boolean(interaction.allowFreeform)}
                      label={field.title ?? name}
                      onChange={(next) => setField(name, next || undefined)}
                      options={field.options}
                      required={Boolean(interaction.schema?.required.includes(name))}
                      value={String(values[name] ?? '')}
                    />
                  )}
                  <Presence show={Boolean(field.description)} motion="fade">
                    <span className="tm-session-request-hint">{field.description}</span>
                  </Presence>
                </div>
              ) : (
                <label className="grid gap-1.5" key={name}>
                  <span className="tm-session-request-label">{field.title ?? name}</span>
                  {
                    <TextInput
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
                  }
                  <Presence show={Boolean(field.description)} motion="fade">
                    <span className="tm-session-request-hint">{field.description}</span>
                  </Presence>
                </label>
              )
            )}
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

/** A request's title, in the coral "needs you" color shared with the sidebar's badge. */
function RequestTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="tm-session-request-title">
      <QuestionIcon aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}
