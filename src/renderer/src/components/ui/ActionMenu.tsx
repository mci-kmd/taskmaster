import { useMemo, useRef, useState, type ReactNode } from 'react'
import Button from './Button'
import Menu, { type MenuItem } from './Menu'

/** A ghost icon button that opens a menu of actions below it. */
export default function ActionMenu({
  label,
  items,
  children,
  triggerClassName
}: {
  label: string
  /** Extra classes for the ghost icon button that opens the menu. */
  triggerClassName?: string
  items: MenuItem[]
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const anchor = useMemo(() => ({ element: trigger }), [])

  return (
    <>
      <Button
        ref={trigger}
        className={triggerClassName}
        iconOnly
        size="xs"
        variant="ghost"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {children}
      </Button>
      <Menu
        anchor={anchor}
        ignore={trigger}
        items={items}
        label={label}
        onClose={(restoreFocus) => {
          setOpen(false)
          if (restoreFocus) trigger.current?.focus()
        }}
        open={open}
      />
    </>
  )
}
