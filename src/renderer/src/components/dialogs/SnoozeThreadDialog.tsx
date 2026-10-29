import { useState } from 'react'
import { snoozeUntil, toDateTimeLocalValue } from '../../lib/snooze'
import { useNow } from '../../lib/useNow'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, TextInput } from '../ui/Field'
import { useDialogSession } from './use-dialog-session'

/** Asks when a thread's custom snooze ends. */
export default function SnoozeThreadDialog({
  open,
  threadTitle,
  onClose,
  onSubmit
}: {
  open: boolean
  threadTitle: string | null
  onClose: () => void
  /** Receives the chosen time as ISO. */
  onSubmit: (until: string) => void
}): React.JSX.Element {
  // Each opening gets a fresh form, even when the dialog reopens while animating out.
  const session = useDialogSession(open)
  return (
    <Modal
      description={
        threadTitle
          ? `“${threadTitle}” leaves the inbox and comes back, awakened, at this time.`
          : 'The thread leaves the inbox and comes back, awakened, at this time.'
      }
      onClose={onClose}
      open={open}
      title="Snooze thread"
      width="sm"
    >
      <SnoozeForm key={session.key} onCancel={onClose} onSubmit={onSubmit} />
    </Modal>
  )
}

function SnoozeForm({
  onCancel,
  onSubmit
}: {
  onCancel: () => void
  onSubmit: (until: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(() => toDateTimeLocalValue(snoozeUntil('tomorrow')))
  const now = useNow(30_000)
  const until = value ? new Date(value) : null
  const valid = until !== null && !Number.isNaN(until.getTime()) && until.getTime() > now
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && until) onSubmit(until.toISOString())
      }}
    >
      <Field
        htmlFor="snooze-until"
        hint={value && !valid ? 'Pick a time in the future.' : undefined}
        label="Snooze until"
      >
        <TextInput
          autoFocus
          id="snooze-until"
          min={toDateTimeLocalValue(new Date(now))}
          onChange={(event) => setValue(event.target.value)}
          type="datetime-local"
          value={value}
        />
      </Field>
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={!valid} title="Snooze thread" type="submit" variant="primary">
          Snooze
        </Button>
      </div>
    </form>
  )
}
