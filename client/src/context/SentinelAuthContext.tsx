import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";

export interface SentinelAuthUser {
  id: number;
  username: string;
  email: string;
  tier: string;
  isAdmin: boolean;
  isActive?: boolean;
}

interface AuthContextType {
  user: SentinelAuthUser | null;
  isLoading: boolean;
  refreshUser: () => Promise<SentinelAuthUser | null>;
  login: (username: string, password?: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function postAuthJson(url: string, body: Record<string, unknown>): Promise<SentinelAuthUser> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const msg =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : text || res.statusText;
    throw new Error(msg);
  }
  return parsed as SentinelAuthUser;
}

export function SentinelAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SentinelAuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async (): Promise<SentinelAuthUser | null> => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as SentinelAuthUser;
        setUser(data);
        return data;
      }
      if (res.status === 401 || res.status === 403) {
        setUser(null);
        return null;
      }
      return null;
    } catch (error) {
      console.error("Auth check failed:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refreshUser();
      setIsLoading(false);
    })();
  }, [refreshUser]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUser();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshUser();
    }, 4 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(heartbeat);
    };
  }, [refreshUser]);

  const login = useCallback(async (username: string, password?: string) => {
    const data = await postAuthJson("/api/auth/login", { username, password: password ?? "" });
    setUser(data);
    await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/me"] });
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const data = await postAuthJson("/api/auth/register", { username, email, password });
    setUser(data);
    await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/me"] });
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      setUser(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/sentinel/me"] });
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, refreshUser, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useSentinelAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useSentinelAuth must be used within a SentinelAuthProvider");
  }
  return context;
}
