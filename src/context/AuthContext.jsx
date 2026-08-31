import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  verifyBeforeUpdateEmail,
} from 'firebase/auth'
import { auth, firebaseConfigured, persistenceReady } from '../lib/firebase'
import { fetchSignupPolicy } from '../api/client'
import { refusalFor } from '../utils/signupPolicy'

const AuthContext = createContext(null)

// Demo mode keeps the public GitHub Pages build usable when no Firebase project
// is wired up. Every branch below is gated on `!firebaseConfigured`, so a real
// deployment never reaches it. The planner store already degrades to its
// encrypted local cache on `not_configured`, so only sign-in needs a fallback.
const DEMO_USER_KEY = 'nw_user'

function demoUid(email) {
  const slug = String(email || 'guest')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    // Trim the separators too: an address of only punctuation collapses to "_",
    // which is truthy, so without this every such user would share one uid.
    .replace(/^_+|_+$/g, '')
  return `demo_${slug || 'guest'}`
}

function demoUser(name, email) {
  const address = String(email || '').trim()
  return {
    id: demoUid(address),
    uid: demoUid(address),
    name: name?.trim() || address.split('@')[0] || 'Planner user',
    email: address,
    emailVerified: true,
    isDemo: true,
  }
}

function persistDemoUser(value) {
  localStorage.setItem(DEMO_USER_KEY, JSON.stringify(value))
  sessionStorage.setItem('nw_authenticated_uid', value.uid)
  return value
}

function publicUser(firebaseUser) {
  if (!firebaseUser) return null
  return {
    id: firebaseUser.uid,
    uid: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Planner user',
    email: firebaseUser.email || '',
    emailVerified: firebaseUser.emailVerified,
  }
}

function authMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'That email already has an account.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/weak-password': 'Use a stronger password with at least 6 characters.',
  }
  return messages[error?.code] || 'Authentication failed. Please try again.'
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!firebaseConfigured || !auth) {
      const stored = localStorage.getItem(DEMO_USER_KEY)
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          // Sessions saved before demo users carried a uid are upgraded in place.
          setUser(persistDemoUser(parsed.uid ? parsed : demoUser(parsed.name, parsed.email)))
        } catch {
          localStorage.removeItem(DEMO_USER_KEY)
        }
      }
      setLoading(false)
      return undefined
    }
    let unsubscribe = () => {}
    persistenceReady.then(() => {
      unsubscribe = onAuthStateChanged(auth, firebaseUser => {
        setUser(publicUser(firebaseUser))
        if (firebaseUser) sessionStorage.setItem('nw_authenticated_uid', firebaseUser.uid)
        else sessionStorage.removeItem('nw_authenticated_uid')
        setLoading(false)
      })
    }).catch(() => setLoading(false))
    return () => unsubscribe()
  }, [])

  const login = async (email, password) => {
    if (!firebaseConfigured || !auth) {
      if (!email?.trim()) return { success: false, error: 'Enter an email address.' }
      setUser(persistDemoUser(demoUser(null, email)))
      return { success: true }
    }
    try {
      await persistenceReady
      await signInWithEmailAndPassword(auth, email.trim(), password)
      return { success: true }
    } catch (error) {
      return { success: false, error: authMessage(error) }
    }
  }

  // Returns a message when the address may not register, else null. Any failure
  // to read the policy returns null: the server is the authority, and a network
  // hiccup here should not block an eligible student from signing up.
  const signupRefusal = async email => {
    try {
      return refusalFor(email, await fetchSignupPolicy())
    } catch {
      return null
    }
  }

  const register = async (name, email, password) => {
    if (!firebaseConfigured || !auth) {
      if (!email?.trim()) return { success: false, error: 'Enter an email address.' }
      setUser(persistDemoUser(demoUser(name, email)))
      return { success: true }
    }
    // Advisory pre-check so an ineligible address is refused before an account
    // exists, rather than creating one that every API call would then reject.
    // The binding check is server-side; this only spares the user the dead end.
    const refusal = await signupRefusal(email)
    if (refusal) return { success: false, error: refusal }
    try {
      await persistenceReady
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
      await updateProfile(credential.user, { displayName: name.trim() })
      await sendEmailVerification(credential.user)
      setUser(publicUser(credential.user))
      return { success: true }
    } catch (error) {
      return { success: false, error: authMessage(error) }
    }
  }

  const updateUser = async updates => {
    if (!firebaseConfigured || !auth) {
      if (!user) throw new Error('Sign in is required')
      // The uid namespaces the encrypted cache, so it stays fixed on rename.
      setUser(persistDemoUser({ ...user, ...updates, uid: user.uid, id: user.id }))
      return
    }
    if (!auth.currentUser) throw new Error('Sign in is required')
    if (updates.name && updates.name !== auth.currentUser.displayName) {
      await updateProfile(auth.currentUser, { displayName: updates.name.trim() })
    }
    if (updates.email && updates.email !== auth.currentUser.email) {
      await verifyBeforeUpdateEmail(auth.currentUser, updates.email.trim())
    }
    setUser(publicUser(auth.currentUser))
  }

  const logout = async () => {
    if (!firebaseConfigured || !auth) {
      localStorage.removeItem(DEMO_USER_KEY)
      sessionStorage.removeItem('nw_authenticated_uid')
      setUser(null)
      return
    }
    await signOut(auth)
    sessionStorage.removeItem('nw_authenticated_uid')
    setUser(null)
    localStorage.removeItem('nw_user')
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// Call this to get { user, login, register, logout }
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
