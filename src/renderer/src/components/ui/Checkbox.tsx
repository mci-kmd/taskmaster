type CheckboxProps = {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label: React.ReactNode
  title?: string
}

export default function Checkbox({
  checked,
  disabled,
  onChange,
  label,
  title
}: CheckboxProps): React.JSX.Element {
  return (
    <label
      className="tm-checkbox"
      data-checked={checked || undefined}
      data-disabled={disabled || undefined}
      title={title}
    >
      <input
        checked={checked}
        className="tm-checkbox__input"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="tm-checkbox__box" aria-hidden>
        {checked ? (
          <svg className="tm-checkbox__check" viewBox="0 0 16 16" fill="none">
            <path
              d="m4 8 3 3 5-6"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      <span className="tm-checkbox__label">{label}</span>
    </label>
  )
}
