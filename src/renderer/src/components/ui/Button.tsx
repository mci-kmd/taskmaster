import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  iconOnly?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    iconOnly = false,
    className = '',
    type = 'button',
    ...rest
  },
  ref
) {
  const classes = [
    'tm-btn',
    `tm-btn--${size}`,
    `tm-btn--${variant}`,
    iconOnly ? 'tm-btn--icon' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return <button ref={ref} type={type} className={classes} {...rest} />
})

export default Button
