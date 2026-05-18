import { useState } from 'react'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, Select, TextArea, TextInput } from '../ui/Field'
import type {
  AgentProviderId,
  AppSettingsSnapshot,
  UpdateSettingsInput
} from '../../../../shared/app-types'
import { parseTaskTagsInput } from '../../../../shared/task-tags'
import { AGENT_PROVIDERS, getAgentProviderDescriptor } from '../../../../shared/agent-providers'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettingsSnapshot
  busy: boolean
  onClose: () => void
  onSubmit: (input: UpdateSettingsInput) => Promise<boolean>
}

export default function SettingsDialog({
  open,
  settings,
  busy,
  onClose,
  onSubmit
}: SettingsDialogProps): React.JSX.Element {
  return (
    <Modal
      description="Applied to every agent CLI launch in every thread."
      onClose={onClose}
      open={open}
      title="Settings"
      width="md"
    >
      <SettingsForm
        busy={busy}
        onCancel={onClose}
        onSubmit={async (input) => {
          const ok = await onSubmit(input)
          if (ok) {
            onClose()
          }
        }}
        settings={settings}
      />
    </Modal>
  )
}

type SettingsFormProps = {
  settings: AppSettingsSnapshot
  busy: boolean
  onCancel: () => void
  onSubmit: (input: UpdateSettingsInput) => Promise<void>
}

function SettingsForm({
  settings,
  busy,
  onCancel,
  onSubmit
}: SettingsFormProps): React.JSX.Element {
  const [agentProviderIdDraft, setAgentProviderIdDraft] = useState(settings.agentProviderId)
  const [draft, setDraft] = useState(settings.globalFlagsInput)
  const [terminalFontFamilyDraft, setTerminalFontFamilyDraft] = useState(
    settings.terminalFontFamilyInput
  )
  const [taskTagsDraft, setTaskTagsDraft] = useState(settings.taskTagsInput)

  const parsedPreview =
    draft === settings.globalFlagsInput
      ? settings.parsedGlobalFlags
      : (draft.match(/("[^"]*"|'[^']*'|\S+)/g) ?? []).map((token) =>
          token.replace(/^['"]|['"]$/g, '')
        )
  const parsedTaskTagsPreview =
    taskTagsDraft === settings.taskTagsInput
      ? settings.parsedTaskTags
      : parseTaskTagsInput(taskTagsDraft)
  const agentProvider = getAgentProviderDescriptor(agentProviderIdDraft)

  const dirty =
    agentProviderIdDraft !== settings.agentProviderId ||
    draft !== settings.globalFlagsInput ||
    terminalFontFamilyDraft !== settings.terminalFontFamilyInput ||
    taskTagsDraft !== settings.taskTagsInput

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && !busy) {
          void onSubmit({
            agentProviderId: agentProviderIdDraft,
            globalFlagsInput: draft,
            terminalFontFamilyInput: terminalFontFamilyDraft,
            taskTagsInput: taskTagsDraft
          })
        }
      }}
    >
      <Field
        hint="The selected provider is used for new launches and resumes."
        label="LLM provider"
      >
        <Select
          autoFocus
          onChange={(event) => setAgentProviderIdDraft(event.target.value as AgentProviderId)}
          value={agentProviderIdDraft}
        >
          {AGENT_PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        hint='Whitespace-separated CLI tokens. Use quotes to group, e.g. --model "gpt-5.5".'
        label={`Global ${agentProvider.label} flags`}
      >
        <TextInput
          onChange={(event) => setDraft(event.target.value)}
          placeholder="--yolo"
          value={draft}
        />
      </Field>

      <Field
        hint="CSS font-family stack for thread terminals. Leave blank to use the built-in Nerd Font fallback stack."
        label="Terminal font family"
      >
        <TextInput
          onChange={(event) => setTerminalFontFamilyDraft(event.target.value)}
          placeholder="'CaskaydiaCove Nerd Font Mono', Consolas, monospace"
          value={terminalFontFamilyDraft}
        />
      </Field>

      <Field
        hint="Comma- or newline-separated labels available in project task create/edit forms."
        label="Task tags"
      >
        <TextArea
          onChange={(event) => setTaskTagsDraft(event.target.value)}
          placeholder={'bug\nfeature'}
          spellCheck={false}
          value={taskTagsDraft}
        />
      </Field>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5">
        <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Active terminal font stack
        </div>
        <div className="mt-1.5 break-words font-mono text-[11.5px] leading-5 text-[var(--color-fg)]">
          {terminalFontFamilyDraft.trim() || settings.resolvedTerminalFontFamily}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Task tag preview
        </div>
        <div className="flex flex-wrap gap-1.5">
          {parsedTaskTagsPreview.length > 0 ? (
            parsedTaskTagsPreview.map((tag) => (
              <span
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-[11.5px] text-[var(--color-fg)]"
                key={tag}
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="text-[12.5px] text-[var(--color-fg-subtle)]">
              No task tags configured.
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Preview
        </div>
        <div className="flex flex-wrap gap-1.5">
          {parsedPreview.length > 0 ? (
            parsedPreview.map((flag, index) => (
              <span
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 font-mono text-[11.5px] text-[var(--color-fg)]"
                key={`${flag}-${index}`}
              >
                {flag}
              </span>
            ))
          ) : (
            <span className="text-[12.5px] text-[var(--color-fg-subtle)]">
              No flags configured.
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-2 pt-1">
        <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={busy || !dirty} title="Save settings" type="submit" variant="primary">
          {busy ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  )
}
