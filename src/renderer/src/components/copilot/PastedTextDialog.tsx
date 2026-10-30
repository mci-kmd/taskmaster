import { useState } from 'react'
import type { CopilotPastedText } from '../../../../shared/app-types'
import { DocumentIcon } from '../Icons'
import Modal from '../Modal'

/** Shows long pasted text in full. */
export default function PastedTextDialog({
  pasted,
  description,
  onClose
}: {
  pasted: CopilotPastedText | null
  description: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      open={pasted !== null}
      title={pasted?.name ?? ''}
      description={description}
      width="xl"
      onClose={onClose}
    >
      <pre className="tm-pasted-text" tabIndex={0} aria-label="Pasted text">
        {pasted?.text}
      </pre>
    </Modal>
  )
}

/** A pill standing in for long text pasted into a sent message; it opens the text. */
export function PastedTextPill({ pasted }: { pasted: CopilotPastedText }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="tm-session-inline-attachment tm-session-inline-pasted"
        title={`Show ${pasted.name}`}
        onClick={() => setOpen(true)}
      >
        <DocumentIcon aria-hidden="true" />
        {pasted.name}
      </button>
      <PastedTextDialog
        pasted={open ? pasted : null}
        description="Sent in place of its pill in your message."
        onClose={() => setOpen(false)}
      />
    </>
  )
}
