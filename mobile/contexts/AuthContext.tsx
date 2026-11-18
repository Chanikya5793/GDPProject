import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification,
  signInWithEmailAndPassword, signOut, updateProfile, verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { User } from '@/types';
import { setStorageUid } from '@/api/storage';
import { disconnectWidgetPush } from '@/api/widgets';
import { campusEmail } from '@/utils/campusEmail';
import { createVerificationSender, verificationMessage } from '@/utils/verificationEmail';
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
  verificationError: string | null;
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
  const [verificationStatus, setVerificationStatus] = useState<{ uid: string; email: string | null; sentAt: number | null; error: string | null } | null>(null);
  const [requestVerification] = useState(() => createVerificationSender(sendEmailVerification));
  const matchesRecipient = verificationStatus?.uid === user?.uid && verificationStatus?.email === user?.email;
  const verificationSentAt = matchesRecipient ? verificationStatus?.sentAt || null : null;
  const verificationError = matchesRecipient ? verificationStatus?.error || null : null;
  const sendVerificationFor = async (recipient: NonNullable<NonNullable<typeof auth>['currentUser']>) => {
    try {
      const sentAt = await requestVerification(recipient);
      if (auth?.currentUser === recipient) setVerificationStatus({ uid: recipient.uid, email: recipient.email, sentAt, error: null });
    } catch (error) {
      if (auth?.currentUser === recipient) setVerificationStatus({ uid: recipient.uid, email: recipient.email, sentAt: null, error: verificationMessage(error) });
      throw error;
    }
  };

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

  const login = async (typed: string, password: string) => {
    const email = campusEmail(typed);
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

  const register = async (name: string, typed: string, password: string) => {
    const email = campusEmail(typed);
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
    let notice = 'Verification email requested. Check your inbox and Junk folder.';
    try { await sendVerificationFor(credential.user); }
    catch (error) { notice = verificationMessage(error); }
    if (auth.currentUser === credential.user) setUser(toUser(credential.user));
    return { success: true, notice };
  };

  // Reloading the profile is not enough on its own. The ID token the API
  // sees carries email_verified from when it was minted and lives for an
  // hour, so a student who had just verified was still refused until they
  // signed out and back in. Force a new token whenever verification is confirmed, including after a restart.
  // The tabs load on `user`, so the new object below makes them fetch again.
  const refreshUser = async () => {
    if (!firebaseConfigured) return user;
    if (!auth?.currentUser) return null;
    const recipient = auth.currentUser;
    await reload(recipient);
    if (auth.currentUser !== recipient) return null;
    if (recipient.emailVerified) await recipient.getIdToken(true);
    if (auth.currentUser !== recipient) return null;
    const refreshed = toUser(recipient);
    setUser(refreshed);
    return refreshed;
  };

  const resendVerification = async () => {
    if (!firebaseConfigured || !auth?.currentUser) return;
    await sendVerificationFor(auth.currentUser);
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
    // While still signed in: the request needs this account's token.
    if (auth?.currentUser) await disconnectWidgetPush();
    if (auth) await signOut(auth);
    if (!firebaseConfigured || !auth) await AsyncStorage.removeItem(DEMO_USER_KEY);
    setStorageUid(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user, loading, configured: firebaseConfigured, login, register, updateUser, logout,
      refreshUser, resendVerification, verificationSentAt, verificationError,
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

