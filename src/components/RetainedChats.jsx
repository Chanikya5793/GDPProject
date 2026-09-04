import { Trash2, RefreshCw, MessageSquare } from 'lucide-react'

/** The day and time a stored exchange belongs to, said the way a person says it. */
export function spokenMoment(value) {
  const moment = new Date(value)
  if (Number.isNaN(moment.getTime())) return ''
  return moment.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/** Whole days left before an exchange is swept, or null once it is due. */
export function daysLeft(expiresAt, now = Date.now()) {
  const remaining = new Date(expiresAt).getTime() - now
  if (Number.isNaN(remaining) || remaining <= 0) return null
  return Math.max(1, Math.round(remaining / 86400000))
}

export default function RetainedChats({ chats, status, error, retainOn, onRefresh, onDelete }) {
  const rows = chats || []
  return (
    <section className="settings-chats" aria-label="Retained copilot chats">
      <div className="settings-chats-head">
        <MessageSquare size={14} />
        <strong>Retained chats</strong>
        <span className="settings-row-desc">
          {rows.length ? `${rows.length} stored` : 'Nothing stored'}
        </span>
        <button className="settings-chats-refresh" onClick={onRefresh}
          disabled={status === 'loading'}>
          <RefreshCw size={12} /> {status === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="login-error">{error}</p>}

      {!rows.length && status !== 'loading' && (
        <p className="settings-row-desc">
          {retainOn
            ? 'Nothing has been kept yet. Exchanges appear here once you ask the assistant something.'
            : 'Retention is off, so nothing new is being kept. Anything saved while it was on would still be listed here.'}
        </p>
      )}

      <ul className="settings-chats-list">
        {rows.map(chat => {
          const left = daysLeft(chat.expires_at)
          return (
            <li key={chat.request_id}>
              <div className="settings-chat-text">
                <span className="settings-chat-question">{chat.question}</span>
                <span className="settings-chat-answer">{chat.answer}</span>
                <span className="settings-chat-meta">
                  {spokenMoment(chat.created_at)}
                  {left === null ? ' · expiring now' : ` · ${left} day${left === 1 ? '' : 's'} left`}
                  {chat.citations?.length ? ` · ${chat.citations.length} source${chat.citations.length === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              <button className="settings-chat-delete" onClick={() => onDelete(chat)}
                aria-label={`Delete "${chat.question}"`}>
                <Trash2 size={13} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
