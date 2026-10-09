import { useEffect, useState } from 'react'
import type {
  CopilotModelOption,
  CopilotModelSelection,
  CopilotReasoningEffort
} from '../../../../shared/app-types'
import { getRendererApi } from '../../shared/api/client'
import ModelPicker from '../copilot/ModelPicker'
import Presence from '../ui/Presence'
import Select from '../ui/Select'

const api = getRendererApi()

const effortLabel = (value: CopilotReasoningEffort): string =>
  value === 'xhigh'
    ? 'Extra high'
    : value === 'max'
      ? 'Maximum'
      : value[0].toUpperCase() + value.slice(1)

/** Model and reasoning effort Copilot uses to write AI commit messages. */
export default function CommitModelPicker({
  value,
  disabled,
  onChange
}: {
  value: CopilotModelSelection
  disabled: boolean
  onChange: (value: CopilotModelSelection) => void
}): React.JSX.Element {
  const [catalog, setCatalog] = useState<{
    models: CopilotModelOption[]
    error: string | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.copilot
      .listModels()
      .then((result) => {
        if (!cancelled) setCatalog({ models: result.models, error: result.error ?? null })
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setCatalog({
            models: [],
            error: cause instanceof Error ? cause.message : String(cause)
          })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const models = catalog?.models ?? []
  const selected = models.find((model) => model.id === value.model)
  const efforts = selected?.supportedReasoningEfforts ?? []
  const effort = value.reasoningEffort ?? ''

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <ModelPicker
          models={models}
          value={value.model}
          disabled={disabled || !models.length}
          placeholder={catalog ? 'No models available' : 'Loading…'}
          onChange={(id) => {
            const next = models.find((model) => model.id === id)
            if (!next) return
            onChange({
              model: next.id,
              reasoningEffort:
                value.reasoningEffort &&
                next.supportedReasoningEfforts.includes(value.reasoningEffort)
                  ? value.reasoningEffort
                  : next.defaultReasoningEffort
            })
          }}
        />
        <Select
          compact
          aria-label="Commit message reasoning effort"
          title="How much reasoning Copilot uses to write the commit message"
          disabled={disabled || (!efforts.length && !effort)}
          value={effort}
          onChange={(next) =>
            onChange({
              model: value.model,
              reasoningEffort: (next || null) as CopilotReasoningEffort | null
            })
          }
          options={[
            {
              value: '',
              label: `Default effort${selected?.defaultReasoningEffort ? ` (${selected.defaultReasoningEffort})` : ''}`
            },
            ...(effort && !efforts.includes(effort)
              ? [{ value: effort, label: effortLabel(effort) }]
              : []),
            ...efforts.map((option) => ({ value: option, label: effortLabel(option) }))
          ]}
        />
      </div>
      <Presence motion="collapse" show={Boolean(catalog?.error)}>
        <p className="text-[12px] leading-5 text-warning" role="status">
          Could not load Copilot models: {catalog?.error}
        </p>
      </Presence>
    </div>
  )
}
