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
      <div className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      {children}
      {hint ? (
        <p className="mt-1.5 text-[12px] leading-5 text-[var(--color-fg-subtle)]">{hint}</p>
      ) : null}
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

const inputClass =
  'block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] transition-colors focus:border-[var(--color-border-strong)] focus:bg-[#1c1c1c]'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  const { className = '', ...rest } = props
  return <input className={`${inputClass} ${className}`} {...rest} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  const { className = '', ...rest } = props
  return (
    <textarea className={`${inputClass} min-h-[112px] resize-y font-mono ${className}`} {...rest} />
  )
}
