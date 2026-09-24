import Select from '../ui/Select'
import ModelPicker from './ModelPicker'
import type { CopilotReasoningEffort, CopilotSessionSnapshot } from '../../../../shared/app-types'

type Props = {
  session: CopilotSessionSnapshot | null
  disabled: boolean
  busy: boolean
  disabledReason: string
  onChange: (model: string, effort: CopilotReasoningEffort | null) => void
}

export default function SessionModelControls({
  session,
  disabled,
  busy,
  disabledReason,
  onChange
}: Props): React.JSX.Element {
  const model = session?.nextModelSelection?.model ?? session?.model
  const selected = session?.models.find((option) => option.id === model)
  const efforts = selected?.supportedReasoningEfforts ?? []
  const effort = session?.nextModelSelection
    ? (session.nextModelSelection.reasoningEffort ?? '')
    : (session?.reasoningEffort ?? '')
  const modelTitle = disabled
    ? disabledReason
    : `Model for your next message${selected ? `: ${selected.name}` : ''}`

  return (
    <>
      <label className="tm-session-setting" title={modelTitle}>
        <span>Model</span>
        <ModelPicker
          models={session?.models ?? []}
          value={model ?? ''}
          disabled={disabled || !session?.models.length}
          placeholder={
            session?.models.length ? 'Choose model' : session ? 'No models available' : 'Loading…'
          }
          onChange={(value) => {
            const next = session?.models.find((model) => model.id === value)
            if (next) {
              const previousEffort = effort
              onChange(
                next.id,
                previousEffort && next.supportedReasoningEfforts.includes(previousEffort)
                  ? previousEffort
                  : next.defaultReasoningEffort
              )
            }
          }}
        />
      </label>
      {efforts.length ? (
        <label
          className="tm-session-setting"
          title={disabled ? disabledReason : 'How much reasoning Copilot uses for the next message'}
        >
          <span>Effort</span>
          <Select
            compact
            aria-label="Reasoning effort"
            disabled={disabled}
            value={effort}
            onChange={(value) => {
              if (model) onChange(model, (value || null) as CopilotReasoningEffort | null)
            }}
            options={[
              {
                value: '',
                label: `Default${selected?.defaultReasoningEffort ? ` (${selected.defaultReasoningEffort})` : ''}`,
                disabled: !selected?.defaultReasoningEffort
              },
              ...(effort && !efforts.includes(effort) ? [{ value: effort, label: effort }] : []),
              ...efforts.map((value) => ({
                value,
                label:
                  value === 'xhigh'
                    ? 'Extra high'
                    : value === 'max'
                      ? 'Maximum'
                      : value[0].toUpperCase() + value.slice(1)
              }))
            ]}
          />
        </label>
      ) : null}
      {busy ? (
        <span className="tm-session-control-status" role="status">
          Applying model settings…
        </span>
      ) : session?.nextModelSelection ? (
        <span className="tm-session-control-status" role="status">
          For next message
        </span>
      ) : null}
    </>
  )
}
