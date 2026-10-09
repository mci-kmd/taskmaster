import { useState } from 'react'
import Button from '../../components/ui/Button'
import Checkbox from '../../components/ui/Checkbox'
import { Field, TextArea, TextInput } from '../../components/ui/Field'
import SegmentedControl from '../../components/ui/SegmentedControl'
import Select from '../../components/ui/Select'
import ActionMenu from '../../components/ui/ActionMenu'
import Modal from '../../components/Modal'
import Toast from '../../components/Toast'
import { GearIcon, PlusIcon } from '../../components/Icons'
import type { GallerySection } from '../gallery-section'

function Primitives(): React.JSX.Element {
  const [view, setView] = useState('copilot')
  const [choice, setChoice] = useState('interactive')
  const [checked, setChecked] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  return (
    <div className="grid grid-cols-2 gap-6 rounded-xl bg-panel p-6 elevation-card">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">
            <PlusIcon width={12} height={12} />
            Primary
          </Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled variant="primary">
            Disabled
          </Button>
          <Button aria-label="Settings" iconOnly size="sm" variant="ghost">
            <GearIcon width={14} height={14} />
          </Button>
          <Button aria-pressed iconOnly size="sm" variant="ghost">
            <GearIcon width={14} height={14} />
          </Button>
          <ActionMenu
            items={[
              { label: 'Edit', onSelect: () => {} },
              { label: 'Close', onSelect: () => {} }
            ]}
            label="Actions"
          >
            ···
          </ActionMenu>
        </div>
        <SegmentedControl
          ariaLabel="View"
          onChange={setView}
          options={[
            { value: 'copilot', label: 'Copilot' },
            { value: 'preview', label: 'Preview' },
            { value: 'terminal', label: 'Terminal' },
            { value: 'diff', label: 'Diff' }
          ]}
          value={view}
        />
        <div className="flex gap-2">
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button onClick={() => setToast(toast ? null : 'Could not save the project.')}>
            Toggle toast
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Field htmlFor="gallery-title" label="Title" hint="A hint below the field.">
          <TextInput id="gallery-title" placeholder="Short task summary" />
        </Field>
        <Field label="Mode">
          <Select
            aria-label="Mode"
            onChange={setChoice}
            options={[
              { value: 'interactive', label: 'Interactive', description: 'Asks before acting' },
              { value: 'plan', label: 'Plan' },
              { value: 'autopilot', label: 'Autopilot' }
            ]}
            value={choice}
          />
        </Field>
        <Checkbox checked={checked} label="Approve requests automatically" onChange={setChecked} />
        <TextArea placeholder={'bug\nfeature'} rows={3} />
      </div>
      <Modal
        description="A dialog with the shared chrome."
        footer={
          <>
            <Button onClick={() => setModalOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)} variant="primary">
              Save
            </Button>
          </>
        }
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        title="Example dialog"
      >
        <p className="text-[13px] text-fg-muted">Dialogs pop in and animate out.</p>
      </Modal>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

const section: GallerySection = {
  id: 'primitives',
  title: 'Primitives',
  order: 0,
  Component: Primitives
}
export default section
