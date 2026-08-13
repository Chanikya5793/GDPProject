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

const AuthContext = createContext(null)

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
      return { success: false, error: 'Firebase Authentication is not configured.' }
    }
    try {
      await persistenceReady
      await signInWithEmailAndPassword(auth, email.trim(), password)
      return { success: true }
    } catch (error) {
      return { success: false, error: authMessage(error) }
    }
  }

  const register = async (name, email, password) => {
    if (!firebaseConfigured || !auth) {
      return { success: false, error: 'Firebase Authentication is not configured.' }
    }
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
    if (!auth?.currentUser) throw new Error('Sign in is required')
    if (updates.name && updates.name !== auth.currentUser.displayName) {
      await updateProfile(auth.currentUser, { displayName: updates.name.trim() })
    }
    if (updates.email && updates.email !== auth.currentUser.email) {
      await verifyBeforeUpdateEmail(auth.currentUser, updates.email.trim())
    }
    setUser(publicUser(auth.currentUser))
  }

  const logout = async () => {
    if (auth) await signOut(auth)
    sessionStorage.removeItem('nw_authenticated_uid')
    setUser(null)
  }

  const value = useMemo(() => ({
    user, loading, configured: firebaseConfigured, login, register, logout, updateUser,
  }), [user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

