import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-2'
}

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--color-fg)] text-[#0c0c0c] hover:bg-white border border-transparent disabled:bg-[var(--color-active)] disabled:text-[var(--color-fg-subtle)]',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-hover)] disabled:opacity-60',
  ghost:
    'bg-transparent text-[var(--color-fg-muted)] border border-transparent hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] disabled:opacity-50',
  danger:
    'bg-transparent text-[var(--color-danger)] border border-[var(--color-border)] hover:bg-[rgba(240,140,140,0.08)] hover:border-[rgba(240,140,140,0.4)] disabled:opacity-50'
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center rounded-md font-medium tracking-tight transition-colors duration-150 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    />
  )
})

export default Button
