import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/client";

// Who is looking at the page: nobody special (the default), or a signed-in,
// authorized editor. `canEdit` only decides what the UI shows -- every edit is
// re-checked by the server, which is the real gatekeeper.

const SIGNED_OUT = {
  enabled: false,
  authenticated: false,
  canEdit: false,
  user: null,
  csrfToken: null,
};

const AuthContext = createContext({
  ...SIGNED_OUT,
  ready: true,
  refresh: async () => {},
  logout: async () => {},
});

// Asks the server who we are. Never throws: any failure (server down, login
// switched off) just means "treat as a plain, read-only visitor".
async function loadMe() {
  try {
    const me = await authApi.me();
    return {
      enabled: !!me.enabled,
      authenticated: !!me.authenticated,
      canEdit: !!me.canEdit,
      user: me.user || null,
      csrfToken: me.csrfToken || null,
    };
  } catch {
    return SIGNED_OUT;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(SIGNED_OUT);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setAuth(await loadMe());
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMe().then((next) => {
      if (cancelled) return;
      setAuth(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout(auth.csrfToken);
    } finally {
      await refresh();
    }
  }, [auth.csrfToken, refresh]);

  const value = useMemo(() => ({ ...auth, ready, refresh, logout }), [auth, ready, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
