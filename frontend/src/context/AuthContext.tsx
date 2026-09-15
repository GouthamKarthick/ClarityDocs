import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import {
  me,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
} from "../api/client";

interface AuthState {
  id: string;
  email: string;
  email_verified: number;
}
const Ctx = createContext<{
  user: AuthState | null;
  loading: boolean;
  login: (e: string, p: string) => Promise<void>;
  register: (e: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await apiLogin(email, password);
    const u = await me();
    setUser(u);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    await apiRegister(email, password);
    const u = await me();
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthContext missing");
  return v;
}