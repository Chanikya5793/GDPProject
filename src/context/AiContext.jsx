import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiConfigured, apiFetch, idempotencyKey } from '../api/client'
import { toHistory } from '../utils/chatHistory'
import { useAuth } from './AuthContext'

const AiContext = createContext(null)

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

  useEffect(() => {
    setMessages([WELCOME])
    setError('')
    controllerRef.current?.abort()
  }, [user?.uid])

  const togglePopOut = useCallback(() => {
    setPoppedOut(previous => {
      const next = !previous
      localStorage.setItem('nw_ai_popped', next ? 'true' : 'false')
      return next
    })
  }, [])

  const sendMessage = useCallback(async text => {
    const trimmed = text.trim()
    if (!trimmed || typing) return
    const userMessage = { id: crypto.randomUUID(), role: 'user', text: trimmed }
    setMessages(previous => [...previous, userMessage])
    setTyping(true)
    setError('')
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const response = await apiFetch('/v1/copilot/chat', {
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
      })
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(), role: 'bot', text: response.answer,
        citations: response.citations || [], retrieval: response.retrieval,
        proposals: response.proposals || [],
      }])
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError(requestError.message)
        setMessages(previous => [...previous, {
          id: crypto.randomUUID(), role: 'error',
          text: requestError.code === 'not_configured'
            ? 'The AI copilot needs the planner backend, which this build is not connected to. Everything else works offline.'
            : requestError.status === 403
            ? 'AI access is off. Enable the planner record types you want indexed in Privacy settings.'
            : requestError.status === 429
              // A budget, not a malfunction — the backend's detail names the wait.
              ? `You have reached the copilot request limit. ${requestError.message}`
              : `The copilot could not answer: ${requestError.message}`,
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

  const clearChat = useCallback(() => {
    controllerRef.current?.abort()
    setMessages([WELCOME])
    setTyping(false)
    setError('')
  }, [])

  return (
    <AiContext.Provider value={{
      poppedOut, togglePopOut, messages, typing, error, sendMessage, cancelResponse,
      clearChat, confirmProposal, rejectProposal,
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

