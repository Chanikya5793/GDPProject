import { Bot } from 'lucide-react'

import { useAi } from '../context/AiContext'

/**
 * Hand one record to the assistant.
 *
 * Lives as its own component because the interesting part is not the button,
 * it is that every surface has to behave the same way about a record the
 * student kept out of the assistant — and three copies of that would drift.
 *
 * A record with AI approval turned off is still attachable. The flag keeps
 * records out of what the assistant reaches for on its own: the index, the
 * search, the briefing. Pointing at one record and asking about it is not
 * that, and the chip above the input says it is being shared for this question
 * only. What it does not do is change the setting.
 */
export default function AskAiButton({ record, kind, className = 'btn-icon' }) {
  const { askAbout, available } = useAi()
  if (!available || !record) return null

  const title = record.title || 'this record'

  return (
    <button
      type="button"
      className={className}
      title="Ask the assistant about this"
      aria-label={`Ask the assistant about ${title}`}
      onClick={event => {
        // Cards are clickable; asking about one should not also open it.
        event.stopPropagation()
        askAbout({
          id: record.id,
          kind,
          title,
          approvedForAi: record._approvedForAi !== false,
        })
      }}
    >
      <Bot size={14} />
    </button>
  )
}
