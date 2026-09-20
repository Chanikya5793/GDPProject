import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification,
  signInWithEmailAndPassword, signOut, updateProfile, verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { User } from '@/types';
import { setStorageUid } from '@/api/storage';
import { auth, firebaseConfigured } from '@/lib/firebase';
import { DEMO_USER_KEY, makeDemoUser, parseStoredDemoUser } from '@/utils/demoAuth';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  configured: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string; notice?: string }>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-read the signed-in user; the verification link is opened elsewhere. */
  refreshUser: () => Promise<User | null>;
  resendVerification: () => Promise<void>;
  /** When the last verification mail went out, for the banner's cooldown. */
  verificationSentAt: number | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

function toUser(value: NonNullable<typeof auth>['currentUser']): User | null {
  if (!value) return null;
  return {
    id: value.uid,
    uid: value.uid,
    name: value.displayName || value.email?.split('@')[0] || 'Planner user',
    email: value.email || '',
    emailVerified: value.emailVerified,
  };
}

function message(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === 'auth/invalid-credential') return 'The email or password is incorrect.';
  if (code === 'auth/email-already-in-use') return 'That email already has an account.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait and try again.';
  return 'Authentication failed. Please try again.';
}

/**
 * Persist a demo session and point storage at its uid.
 *
 * Written through AsyncStorage rather than api/storage, because every key there
 * is namespaced by the current uid — and this record is what establishes that
 * uid in the first place, so it has to live outside the scoped store.
 */
async function persistDemoUser(value: User): Promise<User> {
  setStorageUid(value.uid);
  await AsyncStorage.setItem(DEMO_USER_KEY, JSON.stringify(value));
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [verificationSentAt, setVerificationSentAt] = useState<number | null>(null);

  useEffect(() => {
    // Demo mode: no Firebase project configured, so restore any saved session.
    if (!firebaseConfigured || !auth) {
      AsyncStorage.getItem(DEMO_USER_KEY)
        .then(raw => {
          if (!raw) return;
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch { parsed = null; }
          const restored = parseStoredDemoUser(parsed);
          if (restored) {
            setStorageUid(restored.uid);
            setUser(restored);
          } else {
            // Unusable record: clear it rather than loop on it every launch.
            void AsyncStorage.removeItem(DEMO_USER_KEY);
          }
        })
        .finally(() => setLoading(false));
      return undefined;
    }
    return onAuthStateChanged(auth, firebaseUser => {
      setStorageUid(firebaseUser?.uid || null);
      setUser(toUser(firebaseUser));
      setLoading(false);
    });
  }, []);

  const login = async (email: string, password: string) => {
    if (!firebaseConfigured || !auth) {
      if (!email?.trim()) return { success: false, error: 'Enter an email address.' };
      setUser(await persistDemoUser(makeDemoUser(null, email)));
      return { success: true };
    }
    if (!auth) return { success: false, error: 'Firebase Authentication is not configured.' };
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      return { success: true };
    } catch (error) { return { success: false, error: message(error) }; }
  };

  const register = async (name: string, email: string, password: string) => {
    if (!firebaseConfigured || !auth) {
      if (!email?.trim()) return { success: false, error: 'Enter an email address.' };
      setUser(await persistDemoUser(makeDemoUser(name, email)));
      return { success: true };
    }
    if (!auth) return { success: false, error: 'Firebase Authentication is not configured.' };
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) { return { success: false, error: message(error) }; }
    // The account exists from here on, and the user is signed in. A failure
    // to set the name or send the mail is not a failed sign-up, and used to
    // be reported as one while the session was already live.
    try { await updateProfile(credential.user, { displayName: name.trim() }); } catch { /* set later in Settings */ }
    let notice = 'Check your inbox for the verification link.';
    try { await sendEmailVerification(credential.user); setVerificationSentAt(Date.now()); }
    catch { notice = 'We could not send the verification email just now. Use Resend on the next screen.'; }
    setUser(toUser(credential.user));
    return { success: true, notice };
  };

  // Reloading the profile is not enough on its own. The ID token the API
  // sees carries email_verified from when it was minted and lives for an
  // hour, so a student who had just verified was still refused until they
  // signed out and back in. Force a new token the moment the flag flips.
  // The tabs load on `user`, so the new object below makes them fetch again.
  const refreshUser = async () => {
    if (!firebaseConfigured || !auth?.currentUser) return user;
    const wasVerified = auth.currentUser.emailVerified;
    await reload(auth.currentUser);
    if (auth.currentUser.emailVerified && !wasVerified) await auth.currentUser.getIdToken(true);
    const refreshed = toUser(auth.currentUser);
    setUser(refreshed);
    return refreshed;
  };

  const resendVerification = async () => {
    if (!firebaseConfigured || !auth?.currentUser) return;
    await sendEmailVerification(auth.currentUser);
    setVerificationSentAt(Date.now());
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!firebaseConfigured || !auth) {
      if (!user) throw new Error('Sign in is required');
      // uid/id stay fixed: they namespace the encrypted store, so changing them
      // on a rename would strand the user's planner data.
      setUser(await persistDemoUser({ ...user, ...updates, id: user.id, uid: user.uid }));
      return;
    }
    if (!auth.currentUser) throw new Error('Sign in is required');
    if (updates.name && updates.name !== auth.currentUser.displayName) {
      await updateProfile(auth.currentUser, { displayName: updates.name.trim() });
    }
    if (updates.email && updates.email !== auth.currentUser.email) {
      await verifyBeforeUpdateEmail(auth.currentUser, updates.email.trim());
    }
    setUser(toUser(auth.currentUser));
  };

  const logout = async () => {
    if (auth) await signOut(auth);
    if (!firebaseConfigured || !auth) await AsyncStorage.removeItem(DEMO_USER_KEY);
    setStorageUid(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user, loading, configured: firebaseConfigured, login, register, updateUser, logout,
      refreshUser, resendVerification, verificationSentAt,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

