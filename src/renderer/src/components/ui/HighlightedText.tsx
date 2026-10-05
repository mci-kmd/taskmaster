import { splitHighlightSegments } from '../../lib/task-filter'

export default function HighlightedText({
  text,
  query
}: {
  text: string
  query: string
}): React.JSX.Element {
  return (
    <>
      {splitHighlightSegments(text, query).map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-[3px] bg-[rgba(245,201,122,0.22)] px-[1px] text-[var(--color-fg)]"
          >
            {segment.text}
          </mark>
        ) : (
          segment.text
        )
      )}
    </>
  )
}
