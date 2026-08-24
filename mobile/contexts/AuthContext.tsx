import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification,
  signInWithEmailAndPassword, signOut, updateProfile, verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { User } from '@/types';
import { setStorageUid } from '@/api/storage';
import { auth, firebaseConfigured } from '@/lib/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  configured: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  logout: () => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { setLoading(false); return undefined; }
    return onAuthStateChanged(auth, firebaseUser => {
      setStorageUid(firebaseUser?.uid || null);
      setUser(toUser(firebaseUser));
      setLoading(false);
    });
  }, []);

  const login = async (email: string, password: string) => {
    if (!auth) return { success: false, error: 'Firebase Authentication is not configured.' };
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      return { success: true };
    } catch (error) { return { success: false, error: message(error) }; }
  };

  const register = async (name: string, email: string, password: string) => {
    if (!auth) return { success: false, error: 'Firebase Authentication is not configured.' };
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(credential.user, { displayName: name.trim() });
      await sendEmailVerification(credential.user);
      setUser(toUser(credential.user));
      return { success: true };
    } catch (error) { return { success: false, error: message(error) }; }
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!auth?.currentUser) throw new Error('Sign in is required');
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
    setStorageUid(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, configured: firebaseConfigured, login, register, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

