import { Bot, ShieldAlert, X } from 'lucide-react'

const KIND_LABEL = { task: 'Task', reminder: 'Reminder', note: 'Note' }

/**
 * What the assistant can see, above the box where you type.
 *
 * The alternative was writing "About my note 'Chem notes':" into the input,
 * which is worse in two ways: half of it gets deleted while typing, leaving a
 * mangled sentence in the message, and it hides *that* a record is attached
 * behind *what* was typed. A chip is a thing you can see and take off.
 *
 * The unapproved case says so out loud. That record is being shared for this
 * question and nothing else — the stored setting is untouched — and a student
 * who set that flag deliberately deserves to be told, not to find out later.
 */
export default function AttachedRecordChip({ attachment, onDetach }) {
  if (!attachment) return null
  const kind = KIND_LABEL[attachment.kind] || 'Record'
  const shared = attachment.approvedForAi === false

  return (
    <div
      className={`ai-attachment${shared ? ' ai-attachment-shared' : ''}`}
      role="status"
      aria-label={
        `Attached ${kind.toLowerCase()}: ${attachment.title}. ` +
        (shared
          ? 'This record is kept out of the assistant, and is being shared for this question only.'
          : 'The assistant can read this record.')
      }
    >
      {shared ? <ShieldAlert size={13} aria-hidden="true" /> : <Bot size={13} aria-hidden="true" />}
      <span className="ai-attachment-kind">{kind}</span>
      {/* The full value stays in the title attribute; only the display clips. */}
      <span className="ai-attachment-title" title={attachment.title}>{attachment.title}</span>
      <button
        type="button"
        className="ai-attachment-remove"
        onClick={onDetach}
        aria-label={`Remove ${attachment.title} from this question`}
      >
        <X size={12} />
      </button>
      {shared && (
        <span className="ai-attachment-note">Shared for this question only</span>
      )}
    </div>
  )
}
