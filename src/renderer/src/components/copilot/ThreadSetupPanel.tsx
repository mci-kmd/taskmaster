import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RepositorySnapshot, ThreadSetup, ThreadSetupMode } from '../../../../shared/app-types'
import { THREAD_SETUP_MODES, normalizeThreadSetup } from '../../../../shared/thread-setup'
import SegmentedControl from '../ui/SegmentedControl'
import Select from '../ui/Select'

const SAVE_DELAY_MS = 400

type Props = {
  setup: ThreadSetup
  repository: RepositorySnapshot
  /** The first message is being sent, so the checkout is being made. */
  settingUp: boolean
  onChange: (setup: ThreadSetup) => Promise<unknown> | void
}

/** Picks the checkout a new thread gets once its first message is sent. */
export default function ThreadSetupPanel({
  setup,
  repository,
  settingUp,
  onChange
}: Props): React.JSX.Element {
  const [mode, setMode] = useState<ThreadSetupMode>(setup.mode)
  const [branchName, setBranchName] = useState(setup.branchName ?? '')
  const sent = useRef(setup)
  const timer = useRef<number | null>(null)
  const latest = useRef({ mode: setup.mode, branchName: setup.branchName ?? '' })
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })

  const save = useCallback((): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const next = normalizeThreadSetup(latest.current)
    if (!next) return
    if (next.mode === sent.current.mode && next.branchName === sent.current.branchName) return
    sent.current = next
    void onChangeRef.current(next)
  }, [])
  // A name typed just before leaving still counts.
  useEffect(() => save, [save])
  const changeMode = (value: ThreadSetupMode): void => {
    setMode(value)
    latest.current = { mode: value, branchName }
    save()
  }
  const changeBranchName = (value: string): void => {
    setBranchName(value)
    latest.current = { mode, branchName: value }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, SAVE_DELAY_MS)
  }

  const trunkName = repository.primaryBranch ?? repository.currentBranch
  const description = THREAD_SETUP_MODES.find((option) => option.value === mode)?.description
  const hint = settingUp
    ? 'Setting up the checkout…'
    : mode === 'trunk'
      ? `Works on ${trunkName}. Switching branches needs a clean working tree.`
      : mode === 'branch'
        ? 'Leave blank to name a new branch from your first message. Switching branches needs a clean working tree.'
        : 'Leave blank to name a new worktree from your first message.'

  return (
    <div
      className="tm-thread-setup"
      data-busy={settingUp || undefined}
      role="group"
      aria-label="Checkout for this thread"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) save()
      }}
    >
      <div className="tm-thread-setup-row">
        <span className="tm-thread-setup-label">Checkout</span>
        <fieldset className="tm-thread-setup-modes" disabled={settingUp} title={description}>
          <SegmentedControl<ThreadSetupMode>
            ariaLabel="Checkout mode"
            onChange={changeMode}
            options={THREAD_SETUP_MODES}
            value={mode}
          />
        </fieldset>
        <div className="tm-thread-setup-branch">
          {mode === 'trunk' ? (
            <span className="tm-thread-setup-trunk" title="The project's primary branch">
              {trunkName}
            </span>
          ) : (
            <Select
              editable
              compact
              opensAtTop
              disabled={settingUp}
              aria-label={mode === 'worktree' ? 'Worktree branch' : 'Branch'}
              placeholder="Auto-named from your first message"
              value={branchName}
              onChange={changeBranchName}
              options={
                mode === 'worktree'
                  ? repository.worktreeOptions.map((option) => ({
                      value: option.branchName,
                      label: option.branchName,
                      description: option.path
                    }))
                  : repository.branchOptions.map((option) => ({
                      value: option.value,
                      label: option.value,
                      description: option.label
                    }))
              }
            />
          )}
        </div>
      </div>
      <p className="tm-thread-setup-hint" role={settingUp ? 'status' : undefined}>
        {hint}
      </p>
    </div>
  )
}
