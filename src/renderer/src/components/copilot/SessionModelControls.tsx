import Select from '../ui/Select'
import type {
  CopilotModelOption,
  CopilotReasoningEffort,
  CopilotSessionSnapshot
} from '../../../../shared/app-types'

type Props = {
  session: CopilotSessionSnapshot | null
  disabled: boolean
  busy: boolean
  disabledReason: string
  onChange: (model: string, effort: CopilotReasoningEffort | null) => void
}

function modelDescription(model: CopilotModelOption): string {
  return `${model.name} · ${model.supportsVision ? 'Supports images' : 'Text only'}${model.supportedReasoningEfforts.length ? ' · Adjustable reasoning' : ''}`
}

export default function SessionModelControls({
  session,
  disabled,
  busy,
  disabledReason,
  onChange
}: Props): React.JSX.Element {
  const selected = session?.models.find((model) => model.id === session.model)
  const efforts = selected?.supportedReasoningEfforts ?? []
  const effort = session?.reasoningEffort ?? ''
  const modelTitle = disabled
    ? disabledReason
    : selected
      ? modelDescription(selected)
      : (session?.model ?? 'Choose a model for this conversation')

  return (
    <>
      <label className="tm-session-setting" title={modelTitle}>
        <span>Model</span>
        <Select
          compact
          aria-label="Model"
          disabled={disabled || !session?.models.length}
          value={session?.model ?? ''}
          placeholder={
            session?.models.length ? 'Choose model' : session ? 'No models available' : 'Loading…'
          }
          onChange={(value) => {
            const next = session?.models.find((model) => model.id === value)
            if (next) onChange(next.id, next.defaultReasoningEffort)
          }}
          options={[
            ...(!selected && session?.model
              ? [{ value: session.model, label: session.model }]
              : []),
            ...(session?.models.map((model) => ({
              value: model.id,
              label: model.name,
              description: modelDescription(model)
            })) ?? [])
          ]}
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
              if (session?.model)
                onChange(session.model, (value || null) as CopilotReasoningEffort | null)
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
      ) : null}
    </>
  )
}
