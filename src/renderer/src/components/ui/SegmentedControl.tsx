type Option<T extends string> = {
  value: T
  label: string
  description?: string
}

type SegmentedControlProps<T extends string> = {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
}

export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div aria-label={ariaLabel} className="tm-segmented" role="radiogroup">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            aria-checked={active}
            className="tm-segmented__option"
            data-active={active}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            title={option.description ?? option.label}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
