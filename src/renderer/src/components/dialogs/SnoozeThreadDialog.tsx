import { useState } from 'react'
import {
  parseDateTimeInput,
  snoozeUntil,
  toDateInputValue,
  toTimeInputValue
} from '../../lib/snooze'
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
  const [initial] = useState(() => snoozeUntil('tomorrow'))
  const [date, setDate] = useState(() => toDateInputValue(initial))
  const [time, setTime] = useState(() => toTimeInputValue(initial))
  const now = useNow(30_000)
  const until = parseDateTimeInput(date, time)
  const valid = until !== null && until.getTime() > now
  const hint = !until
    ? 'Pick a date and a 24-hour time, e.g. 08:00 or 16:30.'
    : !valid
      ? 'Pick a time in the future.'
      : undefined
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && until) onSubmit(until.toISOString())
      }}
    >
      <Field htmlFor="snooze-until" hint={hint} label="Snooze until">
        {/* A separate 24-hour time field, since the native datetime picker follows the locale's 12/24-hour clock. */}
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              autoFocus
              id="snooze-until"
              min={toDateInputValue(new Date(now))}
              onChange={(event) => setDate(event.target.value)}
              type="date"
              value={date}
            />
          </div>
          <div className="w-24 shrink-0">
            <TextInput
              aria-label="Time (24-hour)"
              className="tabular-nums"
              inputMode="numeric"
              maxLength={5}
              onChange={(event) => setTime(event.target.value)}
              placeholder="HH:MM"
              type="text"
              value={time}
            />
          </div>
        </div>
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
