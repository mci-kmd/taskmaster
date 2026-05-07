import { useCallback, useState } from 'react'

type ResizeHandleProps = {
  width: number
  min: number
  max: number
  onResize: (next: number) => void
  onResizeEnd: (final: number) => void
  ariaLabel?: string
  title?: string
  collapseWidth?: number
  className?: string
}

export default function ResizeHandle({
  width,
  min,
  max,
  onResize,
  onResizeEnd,
  ariaLabel = 'Resize sidebar',
  title = 'Drag to resize · double-click to collapse',
  collapseWidth,
  className = ''
}: ResizeHandleProps): React.JSX.Element {
  const [dragging, setDragging] = useState(false)

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      let final = width

      const clamp = (value: number): number => Math.min(max, Math.max(min, value))

      const handleMove = (moveEvent: MouseEvent): void => {
        const next = clamp(startWidth + (moveEvent.clientX - startX))
        final = next
        onResize(next)
      }

      const handleUp = (): void => {
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
        document.body.classList.remove('tm-resizing')
        setDragging(false)
        onResizeEnd(final)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
      document.body.classList.add('tm-resizing')
      setDragging(true)
    },
    [width, min, max, onResize, onResizeEnd]
  )

  const handleDoubleClick = useCallback((): void => {
    const next = collapseWidth ?? min
    onResize(next)
    onResizeEnd(next)
  }, [collapseWidth, min, onResize, onResizeEnd])

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={width}
      className={`tm-resize-handle ${className}`.trim()}
      data-dragging={dragging || undefined}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      role="separator"
      title={title}
    >
      <div className="tm-resize-handle__indicator" />
    </div>
  )
}
