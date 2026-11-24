import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Inbox, X } from 'lucide-react';
import { api } from './api.js';

// ============ Helpers ============
const PALETTE = ['#6366F1', '#F97316', '#10B981', '#EC4899', '#0EA5E9', '#8B5CF6', '#F59E0B', '#14B8A6', '#EF4444'];
export function colorFor(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export const CLASS_COLORS = PALETTE;

export function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function useErrorText() {
  const { t } = useTranslation();
  return (err) => {
    if (!err) return '';
    const code = err.code || 'UNKNOWN';
    return t(`errors.${code}`, { defaultValue: err.message || t('errors.UNKNOWN') });
  };
}

export function fmtDate(d, lang = 'vi') {
  if (!d) return '';
  return new Date(d).toLocaleDateString(lang === 'en' ? 'en-GB' : 'vi-VN');
}
export function fmtDateTime(d, lang = 'vi') {
  if (!d) return '';
  return new Date(d).toLocaleString(lang === 'en' ? 'en-GB' : 'vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}
export const fmtScore = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 }));

/** datetime-local value <-> ISO */
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

// ============ Data hook ============
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path);
      if (my === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (my === seq.current) setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

// ============ Toast ============
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((type, text) => {
    const id = Math.random();
    setItems((x) => [...x, { id, type, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  const api = useRef({ success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t) });
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div className="toasts">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.type}`}>{i.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ============ Confirm ============
const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const { t } = useTranslation();
  const confirm = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), []);
  const close = (v) => {
    req?.resolve(v);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!req} onClose={() => close(false)} title={req?.title || t('common.confirm')}>
        <p className="muted">{req?.message}</p>
        <div className="modal-foot">
          <button className="btn" onClick={() => close(false)}>{t('common.cancel')}</button>
          <button className={`btn ${req?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
            {req?.confirmText || t('common.ok')}
          </button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ============ Components ============
export function Modal({ open, onClose, title, children, size }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size === 'lg' ? 'modal-lg' : ''}`} role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Spinner = ({ small }) => <div className={`spinner ${small ? 'spinner-sm' : ''}`} />;

export function Empty({ icon: Icon = Inbox, title, desc, action }) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon size={30} /></div>
      <h3 style={{ color: 'var(--text)' }}>{title}</h3>
      {desc && <p className="small mt-1">{desc}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  const errText = useErrorText();
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div className="form-error row between">
      <span>{errText(error)}</span>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  );
}

export function PageHead({ title, sub, back, actions }) {
  const nav = useNavigate();
  const { t } = useTranslation();
  return (
    <div>
      {back && (
        <button className="back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
          <ArrowLeft size={16} /> {t('common.back')}
        </button>
      )}
      <div className="page-head">
        <div className="grow">
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="row-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  const ref = useRef(null);
  // Cuộn ngang để tab đang chọn luôn hiển thị trên màn hình nhỏ
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector('.tab.active');
    if (box && el) box.scrollLeft = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
  }, [value]);
  return (
    <div className="tabs" role="tablist" ref={ref}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.icon && <t.icon size={16} />}
          {t.label}
          {t.badge ? <span className="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size }) {
  return (
    <div className={`avatar ${size === 'sm' ? 'avatar-sm' : ''}`} style={{ background: colorFor(name) }}>
      {initials(name)}
    </div>
  );
}

export function ClassChip({ name, color }) {
  const label = (name || '').replace(/^(toán|văn|anh|lý|hóa|sinh|math|english)\s*/i, '').slice(0, 4) || initials(name);
  return <div className="class-chip" style={{ background: color || colorFor(name) }}>{label}</div>;
}

export const Badge = ({ tone = 'gray', children }) => <span className={`badge tone-${tone}`}>{children}</span>;

const SUB_TONES = { in_progress: 'gray', submitted: 'orange', ai_processing: 'sky', ai_suggested: 'primary', graded: 'green', none: 'gray' };
export function SubmissionBadge({ status }) {
  const { t } = useTranslation();
  return <Badge tone={SUB_TONES[status || 'none']}>{t(`submission.status.${status || 'none'}`)}</Badge>;
}

const EXAM_TONES = { draft: 'gray', pending_review: 'yellow', published: 'green', archived: 'gray' };
export function ExamStatusBadge({ status }) {
  const { t } = useTranslation();
  return <Badge tone={EXAM_TONES[status]}>{t(`exam.status.${status}`)}</Badge>;
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="xs muted">{hint}</span>}
    </div>
  );
}

export function StatCard({ icon: Icon, value, label, tone = 'primary', onClick }) {
  return (
    <div className={`card stat ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className={`stat-ic tone-${tone}`}><Icon size={20} /></div>
      <div className="stat-val">{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

export function Progress({ value }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  );
}

/** Nút có trạng thái loading tự động khi onClick trả về Promise */
export function AsyncButton({ onClick, children, className = 'btn', disabled, ...rest }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy || disabled}
      onClick={async (e) => {
        setBusy(true);
        try {
          await onClick?.(e);
        } finally {
          setBusy(false);
        }
      }}
      {...rest}
    >
      {busy ? <Spinner small /> : null}
      {children}
    </button>
  );
}
