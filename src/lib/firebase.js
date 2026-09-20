import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean)

let auth = null
let persistenceReady = Promise.resolve()

if (firebaseConfigured) {
  const app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  persistenceReady = setPersistence(auth, browserLocalPersistence)
}

// The hosted action handler Firebase ships with every project. Our own
// handler forwards to it for the flows it does not render itself.
export const defaultActionHandler = firebaseConfigured
  ? `https://${firebaseConfig.authDomain}/__/auth/action`
  : null

export { auth, persistenceReady }

