import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

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

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  const { className = '', children, ...rest } = props
  return (
    <select
      className={`${inputClass} tm-select appearance-none pr-8 ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%236b6b6b' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 10px center',
        colorScheme: 'dark'
      }}
      {...rest}
    >
      {children}
    </select>
  )
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  const { className = '', ...rest } = props
  return (
    <textarea className={`${inputClass} min-h-[112px] resize-y font-mono ${className}`} {...rest} />
  )
}
