import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from './api';
import type { Me } from './types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  signIn: (accessToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const reload = useCallback(async () => {
    setUser(await api.get<Me>('/auth/me'));
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      setAccessToken(null);
      setUser(null);
    });
    refreshSession()
      .then(async (ok) => {
        if (ok) await reload();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [reload]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      reload,
      signIn: async (token) => {
        setAccessToken(token);
        await reload();
      },
      signOut: async () => {
        await api.post('/auth/logout').catch(() => {});
        setAccessToken(null);
        setUser(null);
        qc.clear();
      },
    }),
    [user, loading, reload, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
