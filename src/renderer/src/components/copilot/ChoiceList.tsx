import { useId, useRef, useState } from 'react'
import Presence from '../ui/Presence'

type ChoiceListProps = {
  label: string
  options: string[]
  /** Adds an "Other" choice with a text field for an answer outside the options. */
  allowOther: boolean
  required: boolean
} & (
  | { multiple?: false; value: string; onChange: (value: string) => void }
  | { multiple: true; value: string[]; onChange: (value: string[]) => void }
)

const OTHER_PLACEHOLDER = 'Type your own answer…'

/** Radio or checkbox list for elicitation choices, so every option is visible at once. */
export default function ChoiceList(props: ChoiceListProps): React.JSX.Element {
  const { label, options, allowOther, required } = props
  const name = useId()
  const otherInput = useRef<HTMLInputElement>(null)
  const initialOther = props.multiple
    ? (props.value.find((item) => !options.includes(item)) ?? '')
    : props.value && !options.includes(props.value)
      ? props.value
      : ''
  const [otherSelected, setOtherSelected] = useState(allowOther && initialOther !== '')
  const [otherText, setOtherText] = useState(initialOther)
  const [invalid, setInvalid] = useState(false)
  const selected = props.multiple
    ? props.value.filter((item) => options.includes(item))
    : options.includes(props.value)
      ? [props.value]
      : []

  const emit = (
    nextSelected: string[],
    nextOtherSelected: boolean,
    nextOtherText: string
  ): void => {
    setInvalid(false)
    const other = nextOtherSelected ? nextOtherText.trim() : ''
    if (props.multiple)
      props.onChange(
        other && !nextSelected.includes(other) ? [...nextSelected, other] : nextSelected
      )
    else props.onChange(nextOtherSelected ? other : (nextSelected[0] ?? ''))
  }

  const toggleOption = (option: string): void => {
    if (props.multiple) {
      const next = selected.includes(option)
        ? selected.filter((item) => item !== option)
        : options.filter((item) => item === option || selected.includes(item))
      emit(next, otherSelected, otherText)
    } else {
      setOtherSelected(false)
      emit([option], false, otherText)
    }
  }

  const selectOther = (next: boolean): void => {
    setOtherSelected(next)
    emit(props.multiple ? selected : [], next, otherText)
    if (next) otherInput.current?.focus()
  }

  const inputType = props.multiple ? 'checkbox' : 'radio'
  const renderMark = (checked: boolean): React.JSX.Element => (
    <span className="tm-choice__mark" aria-hidden="true">
      {checked && props.multiple ? (
        <svg viewBox="0 0 16 16" fill="none">
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
  )

  return (
    <div
      aria-label={label}
      className="tm-choices"
      data-multiple={props.multiple || undefined}
      role={props.multiple ? 'group' : 'radiogroup'}
    >
      {options.map((option) => {
        const checked = selected.includes(option) && !(otherSelected && !props.multiple)
        return (
          <label className="tm-choice" data-selected={checked || undefined} key={option}>
            <input
              checked={checked}
              className="tm-choice__input"
              name={name}
              onChange={() => toggleOption(option)}
              required={required && !props.multiple}
              type={inputType}
              value={option}
            />
            {renderMark(checked)}
            <span className="tm-choice__label">{option}</span>
          </label>
        )
      })}
      {allowOther ? (
        <div className="tm-choice tm-choice--other" data-selected={otherSelected || undefined}>
          <label className="tm-choice__other-label">
            <input
              checked={otherSelected}
              className="tm-choice__input"
              name={name}
              onChange={(event) => selectOther(props.multiple ? event.target.checked : true)}
              required={required && !props.multiple}
              type={inputType}
              value=""
            />
            {renderMark(otherSelected)}
            <span className="tm-choice__label">Other</span>
          </label>
          <input
            ref={otherInput}
            aria-label={`${label}: your own answer`}
            className="tm-choice__text"
            onChange={(event) => {
              setOtherText(event.target.value)
              setOtherSelected(true)
              emit(props.multiple ? selected : [], true, event.target.value)
            }}
            onFocus={() => {
              if (!otherSelected) selectOther(true)
            }}
            placeholder={OTHER_PLACEHOLDER}
            required={otherSelected}
            value={otherText}
          />
        </div>
      ) : null}
      {required && props.multiple ? (
        <input
          aria-hidden="true"
          className="tm-picker-validation"
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault()
            setInvalid(true)
          }}
          required
          tabIndex={-1}
          value={props.value.length ? 'selected' : ''}
        />
      ) : null}
      <Presence show={invalid} motion="collapse">
        <span className="tm-picker-error" role="alert">
          Choose at least one option.
        </span>
      </Presence>
    </div>
  )
}
