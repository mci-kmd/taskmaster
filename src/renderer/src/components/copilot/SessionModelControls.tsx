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
        <select
          aria-label="Model"
          disabled={disabled || !session?.models.length}
          value={session?.model ?? ''}
          onChange={(event) => {
            const next = session?.models.find((model) => model.id === event.target.value)
            if (next) onChange(next.id, next.defaultReasoningEffort)
          }}
        >
          {!session?.model ? (
            <option value="" disabled>
              {session?.models.length
                ? 'Choose model'
                : session
                  ? 'No models available'
                  : 'Loading…'}
            </option>
          ) : !selected ? (
            <option value={session.model}>{session.model}</option>
          ) : null}
          {session?.models.map((model) => (
            <option key={model.id} value={model.id} title={modelDescription(model)}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      {efforts.length ? (
        <label
          className="tm-session-setting"
          title={disabled ? disabledReason : 'How much reasoning Copilot uses for the next message'}
        >
          <span>Effort</span>
          <select
            aria-label="Reasoning effort"
            disabled={disabled}
            value={effort}
            onChange={(event) => {
              if (session?.model)
                onChange(
                  session.model,
                  (event.target.value || null) as CopilotReasoningEffort | null
                )
            }}
          >
            <option value="" disabled={!selected?.defaultReasoningEffort}>
              Default
              {selected?.defaultReasoningEffort ? ` (${selected.defaultReasoningEffort})` : ''}
            </option>
            {effort && !efforts.includes(effort) ? <option value={effort}>{effort}</option> : null}
            {efforts.map((value) => (
              <option key={value} value={value}>
                {value === 'xhigh'
                  ? 'Extra high'
                  : value === 'max'
                    ? 'Maximum'
                    : value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
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
