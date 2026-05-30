import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types';
import { getItem, setItem, removeItem } from '@/api/storage';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean }>;
  register: (name: string, email: string, password: string) => Promise<{ success: boolean }>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getItem<User | null>('nw_user', null).then(stored => {
      setUser(stored);
      setLoading(false);
    });
  }, []);

  const login = async (email: string, _password: string) => {
    const mockUser: User = { id: 1, name: 'Bobby Bearcat', email };
    setUser(mockUser);
    await setItem('nw_user', mockUser);
    return { success: true };
  };

  const register = async (name: string, email: string, _password: string) => {
    const mockUser: User = { id: Date.now(), name, email };
    setUser(mockUser);
    await setItem('nw_user', mockUser);
    return { success: true };
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...updates };
    setUser(updated);
    await setItem('nw_user', updated);
  };

  const logout = async () => {
    setUser(null);
    await removeItem('nw_user');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
