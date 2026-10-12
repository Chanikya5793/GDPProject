import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { type Firestore, initializeFirestore } from 'firebase/firestore';
// The Firebase package exposes this only through its React Native conditional
// export; TypeScript's Expo resolver currently selects the browser declaration.
// @ts-expect-error React Native conditional export is available at runtime.
import { getReactNativePersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);

const app = firebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

let auth: ReturnType<typeof getAuth> | null = null;
if (app) {
  try {
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    auth = getAuth(app);
  }
}

export { auth };

let firestore: Firestore | null = null;

/** Only ever used to listen to the content-free change marker; every record
 * still goes through the API. Created on first use so the module stays out
 * of the startup path. Long polling is auto-detected: React Native's fetch
 * cannot stream the way the default WebChannel transport expects. */
export function plannerFirestore(): Firestore | null {
  if (!app) return null;
  firestore ??= initializeFirestore(app, { experimentalAutoDetectLongPolling: true },
    process.env.EXPO_PUBLIC_FIRESTORE_DATABASE || '(default)');
  return firestore;
}
