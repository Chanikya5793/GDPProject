import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { campusEmail } from '../utils/campusEmail'
import '../css/Login.css'

// mode state switches between signing in and registering

export default function Login() {
  const { login, register, configured, requestPasswordReset } = useAuth()
  const [mode, setMode]  = useState('login')   // 'login' or 'register'
  const [name, setName]  = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw]    = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const changeMode = next => {
    setMode(next)
    setPw('')
    setError('')
    setNotice('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setNotice('')
    setBusy(true)
    try {
      // Call the right auth function based on current mode
      if (mode === 'reset') {
        const result = await requestPasswordReset(email)
        if (result.success) setNotice('If a planner account exists for that address, a password reset link will arrive by email.')
        else setError(result.error)
        return
      }
      const result = mode === 'login'
        ? await login(email, pw) : await register(name, email, pw)

      // If it fails, show an error
      if (!result.success) setError(result.error || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">

        {/* LOGO */}
        <div className="login-logo">
          <img src={`${import.meta.env.BASE_URL}N-Monogm-Green.png`} alt="Northwest" className="login-logo-img" />
          <div className="login-logo-text">
            Northwest <span>Student Planner</span>
          </div>
        </div>

        <h1 className="login-title">
          {{ login: 'Welcome back', register: 'Create your account', reset: 'Reset your password' }[mode]}
        </h1>

        <form onSubmit={handleSubmit} className="login-form">

          {/* Name field shows if registering */}
          {mode === 'register' && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" type="text" value={name}
                onChange={e => setName(e.target.value)} placeholder="Bobby Bearcat" required />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="login-email">S number or NW email</label>
            {/* type="text": the browser's email check would refuse a bare S number */}
            <input id="login-email" className="form-input" type="text" value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="S123456" required />
            {email.trim() && !email.includes('@') && (
              <p className="login-hint">{mode === 'reset' ? 'Reset email goes to' : 'Signs in as'} {campusEmail(email)}</p>
            )}
          </div>

          {mode !== 'reset' && (
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Password</label>
              <input id="login-password" className="form-input" type="password" value={pw}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                onChange={e => setPw(e.target.value)} placeholder="********" required />
            </div>
          )}

          {error && <p className="login-error" role="alert">{error}</p>}
          {notice && <p className="login-help" role="status">{notice}</p>}

          <button type="submit" className="btn-primary" disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '11px' }}>
            {{ login: 'Sign In', register: 'Create Account', reset: 'Send reset link' }[mode]}
          </button>

        </form>

        {/* Switch between login and register */}
        <div className="login-switch">
          {configured && mode === 'login' && (
            <p><button disabled={busy} onClick={() => changeMode('reset')}>Forgot password?</button></p>
          )}
          {mode === 'login' ? (
            <p>Don't have an account?{' '}
              <button disabled={busy} onClick={() => changeMode('register')}>Sign up</button>
            </p>
          ) : (
            <p>{mode === 'register' && 'Already have an account? '}
              <button disabled={busy} onClick={() => changeMode('login')}>Sign in</button>
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
