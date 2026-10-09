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
          <mark key={index} className="tm-highlight">
            {segment.text}
          </mark>
        ) : (
          segment.text
        )
      )}
    </>
  )
}
