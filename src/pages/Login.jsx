import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import '../css/Login.css'

// mode state switches between signing in and registering

export default function Login() {
  const { login, register } = useAuth()
  const [mode, setMode]  = useState('login')   // 'login' or 'register'
  const [name, setName]  = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw]    = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Call the right auth function based on current mode
    const result = mode === 'login' 
      ? await login(email, pw) : await register(name, email, pw)

    // If it fails, show an error
    if (!result.success) setError(result.error || 'Something went wrong.')
  }

  return (
    <div className="login-wrap">
      <div className="login-card">

        {/* LOGO */}
        <div className="login-logo">
          <img src="/N-Monogm-Green.png" alt="Northwest" className="login-logo-img" />
          <div className="login-logo-text">
            Northwest <span>Student Planner</span>
          </div>
        </div>

        <h1 className="login-title">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
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
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="bobbybearcat@nwmissouri.edu" required />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={pw}
              onChange={e => setPw(e.target.value)} placeholder="********" required />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '11px' }}>
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

        </form>

        {/* Switch between login and register */}
        <div className="login-switch">
          {mode === 'login' ? (
            <p>Don't have an account?{' '}
              <button onClick={() => setMode('register')}>Sign up</button>
            </p>
          ) : (
            <p>Already have an account?{' '}
              <button onClick={() => setMode('login')}>Sign in</button>
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
