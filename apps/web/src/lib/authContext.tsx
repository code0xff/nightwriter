import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AuthSession, PublicUser } from "@nightwriter/shared";
import { setAuthToken } from "./api";
import { fetchMe } from "./authApi";

const TOKEN_KEY = "nw_token";

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  setSession: (session: AuthSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    setAuthToken(token);
    fetchMe()
      .then((r) => setUser(r.user))
      .catch(() => {
        setAuthToken(null);
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setLoading(false));
  }, []);

  const setSession = (session: AuthSession) => {
    localStorage.setItem(TOKEN_KEY, session.token);
    setAuthToken(session.token);
    setUser(session.user);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
