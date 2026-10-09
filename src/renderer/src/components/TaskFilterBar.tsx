import { useRef, type KeyboardEvent } from 'react'
import type { ProjectTaskTag } from '../../../shared/app-types'
import { getTaskTagTone } from '../lib/task-tag-tone'
import { CloseIcon, SearchIcon } from './Icons'
import Button from './ui/Button'
import { TextInput } from './ui/Field'
import Presence from './ui/Presence'

type TaskFilterBarProps = {
  query: string
  onQueryChange: (query: string) => void
  labels: readonly ProjectTaskTag[]
  selectedLabels: readonly ProjectTaskTag[]
  onToggleLabel: (label: ProjectTaskTag) => void
  active: boolean
  onClear: () => void
}

export default function TaskFilterBar({
  query,
  onQueryChange,
  labels,
  selectedLabels,
  onToggleLabel,
  active,
  onClear
}: TaskFilterBarProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && query.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      onQueryChange('')
    }
  }

  const handleClear = (): void => {
    onClear()
    input.current?.focus()
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2" role="search">
      <div className="relative min-w-[220px] flex-1">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
          height={14}
          width={14}
        />
        <TextInput
          ref={input}
          aria-label="Search tasks"
          className="tm-task-search py-1.5 pl-8"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search #number, title or description"
          spellCheck={false}
          type="search"
          value={query}
        />
      </div>

      <Presence motion="fade" show={labels.length > 0}>
        <div
          aria-label="Filter by label"
          className="flex flex-wrap items-center gap-1.5"
          role="group"
        >
          {labels.map((label) => {
            const selected = selectedLabels.includes(label)
            return (
              <button
                key={label}
                aria-pressed={selected}
                className="tm-label-chip"
                data-tone={getTaskTagTone(label)}
                onClick={() => onToggleLabel(label)}
                title={selected ? `Stop filtering by ${label}` : `Show tasks labeled ${label}`}
                type="button"
              >
                {label}
              </button>
            )
          })}
        </div>
      </Presence>

      <Presence motion="fade" show={active}>
        <Button
          onClick={handleClear}
          size="sm"
          title="Clear search and label filters"
          variant="ghost"
        >
          <CloseIcon height={12} width={12} />
          Clear
        </Button>
      </Presence>
    </div>
  )
}
