import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  getToken,
  setToken,
  clearToken,
  getStoredEmail,
  setStoredEmail,
  clearStoredEmail,
} from '../lib/auth';

interface AuthContextValue {
  token: string | null;
  email: string | null;
  login: (token: string, email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(() => getToken());
  const [email, setEmail] = useState<string | null>(() => getStoredEmail());

  const login = (t: string, e: string) => {
    setToken(t);
    setStoredEmail(e);
    setTok(t);
    setEmail(e);
  };

  const logout = () => {
    clearToken();
    clearStoredEmail();
    setTok(null);
    setEmail(null);
  };

  // API 层发现 401 时广播该事件, 同步清空内存态 (否则 RequireAuth 仍认为已登录)
  useEffect(() => {
    const onUnauthorized = () => {
      setTok(null);
      setEmail(null);
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  return (
    <AuthContext.Provider value={{ token, email, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
