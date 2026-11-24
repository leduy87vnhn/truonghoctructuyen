import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, store } from './api.js';
import i18n from './i18n/index.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, workspaces: [], invites: [] });
  const [wsId, setWsId] = useState(store.getWs());

  const applySession = useCallback((data) => {
    const list = data.workspaces || [];
    let current = store.getWs();
    if (!list.find((w) => w.id === current)) {
      current = list[0]?.id || null;
      store.setWs(current);
    }
    setWsId(current);
    setState({ loading: false, user: data.user, workspaces: list, invites: data.invites || [] });
    if (data.user?.locale && data.user.locale !== i18n.language) {
      i18n.changeLanguage(data.user.locale);
      store.setLang(data.user.locale);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!store.getToken()) {
      setState({ loading: false, user: null, workspaces: [], invites: [] });
      return;
    }
    try {
      applySession(await api.get('/auth/me'));
    } catch {
      store.setToken(null);
      setState({ loading: false, user: null, workspaces: [], invites: [] });
    }
  }, [applySession]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (store.getToken()) {
        store.setToken(null);
        setState({ loading: false, user: null, workspaces: [], invites: [] });
      }
    });
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    store.setToken(r.token);
    await refresh();
    return r.user;
  };

  /** Trả về { pending: true, email } nếu cần xác minh email, ngược lại đăng nhập luôn. */
  const register = async (payload) => {
    const r = await api.post('/auth/register', { ...payload, locale: i18n.language === 'en' ? 'en' : 'vi' });
    if (r.pending) return r;
    store.setToken(r.token);
    await refresh();
    return r;
  };

  /** Dùng sau khi xác minh email / đặt lại mật khẩu: server trả về token mới. */
  const loginWithToken = async (token) => {
    store.setToken(token);
    await refresh();
  };

  const logout = () => {
    store.setToken(null);
    store.setWs(null);
    setState({ loading: false, user: null, workspaces: [], invites: [] });
  };

  const switchWorkspace = (id) => {
    store.setWs(id);
    setWsId(id);
  };

  const setLocale = async (locale) => {
    i18n.changeLanguage(locale);
    store.setLang(locale);
    document.documentElement.lang = locale;
    if (state.user) {
      await api.patch('/auth/me', { locale }).catch(() => {});
      setState((s) => ({ ...s, user: { ...s.user, locale } }));
    }
  };

  const workspace = state.workspaces.find((w) => w.id === wsId) || null;
  const perms = useMemo(() => new Set(workspace?.permissions || []), [workspace]);

  const value = {
    ...state,
    workspace,
    can: (p) => perms.has(p),
    isStudent: state.user?.account_type === 'student',
    isAdmin: Boolean(state.user?.is_system_admin),
    login,
    register,
    loginWithToken,
    logout,
    refresh,
    switchWorkspace,
    setLocale,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
