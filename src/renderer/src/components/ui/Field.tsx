import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

type FieldShellProps = {
  label: string
  hint?: string
  children: React.ReactNode
  htmlFor?: string
}

export function Field({ label, hint, children, htmlFor }: FieldShellProps): React.JSX.Element {
  const content = (
    <>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
        {label}
      </div>
      {children}
      {hint ? <p className="mt-1.5 text-[12px] leading-5 text-fg-subtle">{hint}</p> : null}
    </>
  )

  if (htmlFor) {
    return (
      <label className="block" htmlFor={htmlFor}>
        {content}
      </label>
    )
  }

  return <div className="block">{content}</div>
}

// Styled by .tm-input (styles/components/field.css).
const inputClass = 'tm-input block w-full'

export function TextInput(
  props: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }
): React.JSX.Element {
  const { className = '', ...rest } = props
  return <input className={`${inputClass} ${className}`} {...rest} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  const { className = '', ...rest } = props
  return (
    <textarea className={`${inputClass} min-h-[112px] resize-y font-mono ${className}`} {...rest} />
  )
}
