import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiConfigured, apiFetch, apiStream, idempotencyKey } from '../api/client'
import { getSecureItem, removeSecureItem, setSecureItem } from '../security/cryptoStore'
import { toHistory } from '../utils/chatHistory'
import { useAuth } from './AuthContext'

const AiContext = createContext(null)

// The conversation survives a reload. It used to live in React state alone, so
// refreshing mid-thread lost the thing the assistant had just asked about and
// the answer it was waiting for. Kept in the same encrypted per-user store the
// planner cache uses, never on the server, so turning chat retention on is
// still a separate decision.
const CHAT_STORE = 'ai:conversation'
// Enough to keep a working thread without growing without bound. The API only
// replays the last 20 turns anyway.
const KEPT_MESSAGES = 60

const WELCOME = {
  id: 'welcome',
  role: 'bot',
  text: 'Ask about planner records you have approved for AI. I’ll cite exact sources and preview every requested change before anything is applied.',
  retrieval: { attempted: false, result_count: 0, entity_types: [], abstained: false },
  citations: [],
  proposals: [],
}

export function AiProvider({ children }) {
  const { user } = useAuth()
  const [poppedOut, setPoppedOut] = useState(() =>
    localStorage.getItem('nw_ai_popped') === 'true'
  )
  const [messages, setMessages] = useState([WELCOME])
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef(null)
  // sendMessage is memoised on `typing` alone, so reading `messages` from its
  // closure would replay a stale conversation. The ref always holds the current
  // one.
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])
  // Who processes approved records, read from the server so this copy cannot
  // drift from whatever provider is actually deployed.
  const [aiInfo, setAiInfo] = useState(null)
  // The assistant is on by default, so the first thing a student sees has to say
  // where their planner text goes. Acknowledged per uid: a different account on
  // the same browser has not been told anything.
  const noticeKey = user?.uid ? `nw_ai_notice_${user.uid}` : null
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(true)

  useEffect(() => {
    if (!noticeKey) { setNoticeAcknowledged(true); return }
    setNoticeAcknowledged(localStorage.getItem(noticeKey) === 'seen')
  }, [noticeKey])

  const acknowledgeNotice = useCallback(() => {
    if (noticeKey) localStorage.setItem(noticeKey, 'seen')
    setNoticeAcknowledged(true)
  }, [noticeKey])

  useEffect(() => {
    if (!apiConfigured()) return
    apiFetch('/v1/ai-info').then(setAiInfo).catch(() => setAiInfo(null))
  }, [user?.uid])

  // True once the stored conversation has been read back, so the empty first
  // render cannot be written over the top of it.
  const [restored, setRestored] = useState(false)
  // Reading the store is async, so a message sent before it resolves would be
  // wiped by the restore landing on top of it. Anything that puts a message on
  // screen bumps this, and a restore from an older generation is dropped.
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = ++generationRef.current
    setRestored(false)
    setError('')
    controllerRef.current?.abort()
    if (!user?.uid) {
      setMessages([WELCOME])
      setRestored(true)
      return
    }
    const settle = saved => {
      if (generationRef.current !== generation) return
      setMessages(saved?.length ? saved : [WELCOME])
      setRestored(true)
    }
    getSecureItem(user.uid, CHAT_STORE, null).then(settle).catch(() => settle(null))
  }, [user?.uid])

  useEffect(() => {
    // Only after a restore, and never mid-stream: a half-written answer is not
    // worth persisting, and the final event rewrites it anyway.
    if (!restored || !user?.uid || typing) return
    // An untouched thread is nothing to restore, and writing it back would
    // undo the clear that just removed it.
    if (!messages.some(message => message.id !== WELCOME.id)) return
    setSecureItem(user.uid, CHAT_STORE, messages.slice(-KEPT_MESSAGES)).catch(() => {})
  }, [messages, restored, typing, user?.uid])

  const togglePopOut = useCallback(() => {
    setPoppedOut(previous => {
      const next = !previous
      localStorage.setItem('nw_ai_popped', next ? 'true' : 'false')
      return next
    })
  }, [])

  const failureText = requestError =>
    requestError.code === 'not_configured'
      ? 'The AI copilot needs the planner backend, which this build is not connected to. Everything else works offline.'
      : requestError.status === 403
      ? 'AI access is off. Enable the planner record types you want indexed in Privacy settings.'
      : requestError.status === 429
        // A budget, not a malfunction — the backend's detail names the wait.
        ? `You have reached the copilot request limit. ${requestError.message}`
        : `The copilot could not answer: ${requestError.message}`

  const sendMessage = useCallback(async text => {
    const trimmed = text.trim()
    if (!trimmed || typing) return
    const userMessage = { id: crypto.randomUUID(), role: 'user', text: trimmed }
    // Supersede any restore still in flight, and allow saving from here on:
    // what is on screen now is the conversation, not whatever the store held.
    generationRef.current += 1
    setRestored(true)
    setMessages(previous => [...previous, userMessage])
    setTyping(true)
    setError('')
    const controller = new AbortController()
    controllerRef.current = controller
    const botId = crypto.randomUUID()
    let streamed = ''
    let steps = []
    let settled = false
    let streamFailure = null
    // Creates the reply on the first delta and patches it in place afterwards,
    // so the bubble is not added until there is something to put in it.
    const upsertReply = patch => setMessages(previous => {
      const index = previous.findIndex(message => message.id === botId)
      if (index === -1) {
        return [...previous, {
          id: botId, role: 'bot', text: '', citations: [], proposals: [], steps: [], ...patch,
        }]
      }
      const next = [...previous]
      next[index] = { ...next[index], ...patch }
      return next
    })
    try {
      await apiStream('/v1/copilot/chat/stream', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          request_id: idempotencyKey('chat'),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          // Everything said before this message, so a clarifying question can be
          // answered and picked up from.
          history: toHistory(messagesRef.current),
        }),
      }, ({ event, data }) => {
        if (event === 'delta') {
          streamed += data.text || ''
          upsertReply({ text: streamed, streaming: true })
        } else if (event === 'step') {
          // The assistant looked something up for itself. Anything streamed so
          // far belonged to the round it has now moved past, so it is cleared
          // rather than left above an answer it no longer leads into.
          steps = [...steps, data]
          streamed = ''
          upsertReply({ steps, text: '', streaming: true })
        } else if (event === 'final') {
          // Authoritative. The citation guard can replace the whole answer once
          // the structured result is parsed, and a change that could not be
          // prepared appends to it, so this replaces the streamed text rather
          // than adding to it.
          settled = true
          upsertReply({
            text: data.answer,
            citations: data.citations || [],
            retrieval: data.retrieval,
            proposals: data.proposals || [],
            steps,
            streaming: false,
          })
        } else if (event === 'error') {
          streamFailure = data
        }
      })
      if (!settled) {
        // Either the model failed mid-answer or the connection dropped. Keep
        // whatever text arrived, but do not leave it looking complete.
        upsertReply({ streaming: false })
        const detail = streamFailure?.detail || 'The connection ended before the answer was finished.'
        setError(detail)
        setMessages(previous => [...previous, {
          id: crypto.randomUUID(), role: 'error', text: detail,
          citations: [], proposals: [],
        }])
      }
    } catch (requestError) {
      if (requestError.name === 'AbortError') {
        upsertReply({ streaming: false })
      } else {
        setError(requestError.message)
        upsertReply({ streaming: false })
        setMessages(previous => [...previous, {
          id: crypto.randomUUID(), role: 'error', text: failureText(requestError),
          citations: [], proposals: [],
        }])
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setTyping(false)
    }
  }, [typing])

  const cancelResponse = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setTyping(false)
    setError('Response cancelled.')
  }, [])

  const updateProposal = useCallback((proposalId, nextProposal) => {
    setMessages(previous => previous.map(message => ({
      ...message,
      proposals: message.proposals?.map(proposal =>
        proposal.proposal_id === proposalId ? nextProposal : proposal
      ),
    })))
  }, [])

  const confirmProposal = useCallback(async proposal => {
    const confirmed = await apiFetch(`/v1/proposals/${proposal.proposal_id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        idempotency_key: idempotencyKey('confirm'),
        expected_base_revision: proposal.base_revision,
      }),
    })
    updateProposal(proposal.proposal_id, confirmed)
    return confirmed
  }, [updateProposal])

  const rejectProposal = useCallback(async proposal => {
    const rejected = await apiFetch(`/v1/proposals/${proposal.proposal_id}/reject`, {
      method: 'POST', body: JSON.stringify({ reason: 'Rejected in assistant UI' }),
    })
    updateProposal(proposal.proposal_id, rejected)
    return rejected
  }, [updateProposal])

  // Applied one at a time on purpose: each confirmation carries its own
  // expected_base_revision, so a record someone edited in another tab is the
  // only one that fails while the rest still land. The first failure stops the
  // run rather than pressing on, because the later changes were usually agreed
  // to on the assumption the earlier ones happened.
  const confirmProposals = useCallback(async proposals => {
    for (const proposal of proposals) {
      if (proposal.status === 'pending') await confirmProposal(proposal)
    }
  }, [confirmProposal])

  const rejectProposals = useCallback(async proposals => {
    for (const proposal of proposals) {
      if (proposal.status === 'pending') await rejectProposal(proposal)
    }
  }, [rejectProposal])

  const clearChat = useCallback(() => {
    controllerRef.current?.abort()
    setMessages([WELCOME])
    setTyping(false)
    setError('')
    if (user?.uid) removeSecureItem(user.uid, CHAT_STORE)
  }, [user?.uid])

  return (
    <AiContext.Provider value={{
      poppedOut, togglePopOut, messages, typing, error, sendMessage, cancelResponse,
      clearChat, confirmProposal, rejectProposal, confirmProposals, rejectProposals,
      aiInfo, noticeAcknowledged, acknowledgeNotice,
      // Whether a backend exists at all. The sidebar uses this to explain the
      // copilot is unavailable instead of letting people send doomed requests.
      available: apiConfigured(),
    }}>
      {children}
    </AiContext.Provider>
  )
}

export function useAi() {
  const context = useContext(AiContext)
  if (!context) throw new Error('useAi must be used inside AiProvider')
  return context
}

