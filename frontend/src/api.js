// API client: tự gắn token, workspace hiện tại và ngôn ngữ vào mỗi request.
const BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'tw.token';
const WS_KEY = 'tw.workspace';

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const store = {
  getToken: () => safe(() => localStorage.getItem(TOKEN_KEY)),
  setToken: (t) => safe(() => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))),
  getWs: () => safe(() => localStorage.getItem(WS_KEY)),
  setWs: (id) => safe(() => (id ? localStorage.setItem(WS_KEY, id) : localStorage.removeItem(WS_KEY))),
  getLang: () => safe(() => localStorage.getItem('tw.lang')) || 'vi',
  setLang: (l) => safe(() => localStorage.setItem('tw.lang', l)),
};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

function headers(extra = {}) {
  const h = { 'Accept-Language': store.getLang(), ...extra };
  const token = store.getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  const ws = store.getWs();
  if (ws) h['X-Workspace-Id'] = ws;
  return h;
}

export async function api(path, { method = 'GET', body, form } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: headers(form ? {} : { 'Content-Type': 'application/json' }),
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
  }
  if (res.status === 401) {
    onUnauthorized();
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.code || 'HTTP_' + res.status, data?.message, data?.details);
  return data;
}

api.get = (p) => api(p);
api.post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
api.put = (p, body) => api(p, { method: 'PUT', body });
api.patch = (p, body) => api(p, { method: 'PATCH', body });
api.del = (p) => api(p, { method: 'DELETE' });
api.upload = (p, form) => api(p, { method: 'POST', form });

/** Tải file (Excel...) có kèm header xác thực. */
export async function download(path, filename) {
  const res = await fetch(BASE + path, { headers: headers() });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
