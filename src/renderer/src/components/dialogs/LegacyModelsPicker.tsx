import { useEffect, useState } from 'react'
import type { CopilotModelOption } from '../../../../shared/app-types'
import { getRendererApi } from '../../shared/api/client'
import { modelFamily } from '../copilot/model-families'
import Select from '../ui/Select'

const api = getRendererApi()

/** Chooses the models the model picker tucks under a Legacy row in their family. */
export default function LegacyModelsPicker({
  value,
  disabled,
  onChange
}: {
  value: string[]
  disabled?: boolean
  onChange: (value: string[]) => void
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
          setCatalog({ models: [], error: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const models = catalog?.models ?? []
  // Keep chosen models that the catalog no longer lists so they can still be removed.
  const unknown = value.filter((id) => !models.some((model) => model.id === id))
  const options = [
    ...models
      .map((model) => ({ value: model.id, label: model.name, group: modelFamily(model) }))
      .sort((a, b) => a.group.localeCompare(b.group)),
    ...unknown.map((id) => ({ value: id, label: id, group: 'Unavailable models' }))
  ]

  return (
    <div className="space-y-1.5">
      <Select
        multiple
        aria-label="Legacy models"
        disabled={disabled || (!catalog && !value.length)}
        placeholder={catalog ? 'No legacy models' : 'Loading…'}
        value={value}
        onChange={onChange}
        options={options}
      />
      {catalog?.error ? (
        <p className="text-[12px] leading-5 text-[var(--color-warning)]" role="status">
          Could not load Copilot models: {catalog.error}
        </p>
      ) : null}
    </div>
  )
}
