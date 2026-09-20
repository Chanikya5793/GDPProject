import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { defaultActionHandler } from '../lib/firebase'
import '../css/Login.css'

/* The page a verification link opens.

   Firebase's hosted handler applies the code the moment the page loads. Two
   things went wrong with that: the university's mail filter opens every link
   in an external message to scan it, which used the code up before the
   student could; and when a code was dead for any reason the student saw
   "expired or already been used" with no way forward. Here the code is
   applied on a click, and a dead one says what to do next.

   Only the verification flows are rendered. Anything else the link can carry
   (a password reset, an email-change recovery) goes to the hosted handler,
   which already has the right screens. */

const VERIFY_MODES = new Set(['verifyEmail', 'verifyAndChangeEmail', 'recoverEmail'])

export function actionParams(search = window.location.search) {
  const params = new URLSearchParams(search)
  const mode = params.get('mode')
  const code = params.get('oobCode')
  return mode && code ? { mode, code, search } : null
}

function describe(error) {
  switch (error?.code) {
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'This link has expired or was already used. Only the newest email works: sign in, press Resend, and open the link in that message.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/user-not-found':
      return 'The account this link belongs to no longer exists.'
    default:
      return error?.message || 'The link could not be applied.'
  }
}

export default function AuthAction({ params }) {
  const { user, applyVerification } = useAuth()
  const [state, setState] = useState('ready') // ready | working | done | failed
  const [message, setMessage] = useState('')
  const appHome = `${window.location.origin}${window.location.pathname}`

  const forwardable = !VERIFY_MODES.has(params.mode) && defaultActionHandler
  useEffect(() => {
    if (forwardable) window.location.replace(`${defaultActionHandler}${params.search}`)
  }, [forwardable, params.search])

  const confirm = async () => {
    setState('working')
    setMessage('')
    try {
      const refreshed = await applyVerification(params.code)
      setState('done')
      setMessage(refreshed
        ? 'Your email is verified. Taking you to your planner…'
        : 'Your email is verified. Sign in to open your planner.')
      // Drop the query so a reload cannot re-apply the code, then land on
      // the dashboard with the freshly minted token.
      if (refreshed) setTimeout(() => window.location.replace(`${appHome}#/`), 1200)
    } catch (error) {
      setState('failed')
      setMessage(describe(error))
    }
  }

  const title = {
    verifyEmail: 'Confirm your email',
    verifyAndChangeEmail: 'Confirm your new email',
    recoverEmail: 'Restore your previous email',
  }[params.mode] || 'Confirm'

  if (forwardable) {
    return (
      <div className="login-wrap">
        <div className="login-card"><p>One moment…</p></div>
      </div>
    )
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img src={`${import.meta.env.BASE_URL}N-Monogm-Green.png`} alt="Northwest" className="login-logo-img" />
          <div className="login-logo-text">Northwest <span>Student Planner</span></div>
        </div>
        <h1 className="login-title">{title}</h1>
        {state === 'ready' && (
          <>
            <p className="login-help">
              Press the button to finish{user?.email ? ` verifying ${user.email}` : ''}. This step is here so
              only you can use the link.
            </p>
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px' }}
              onClick={confirm}>
              Verify my email
            </button>
          </>
        )}
        {state === 'working' && <p className="login-help">Verifying…</p>}
        {state === 'done' && (
          <>
            <p className="login-help">{message}</p>
            {!user && (
              <a className="btn-primary" style={{ display: 'block', textAlign: 'center', padding: '11px' }}
                href={`${appHome}#/login`}>Sign in</a>
            )}
          </>
        )}
        {state === 'failed' && (
          <>
            <p className="login-error" role="alert">{message}</p>
            <a className="btn-primary" style={{ display: 'block', textAlign: 'center', padding: '11px' }}
              href={`${appHome}#/`}>Back to the planner</a>
          </>
        )}
      </div>
    </div>
  )
}
