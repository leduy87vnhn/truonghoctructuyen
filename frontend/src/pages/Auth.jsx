import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpenCheck, CheckCircle2, GraduationCap, KeyRound, Lock, Mail, MailCheck, School, User, XCircle } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { LANGUAGES } from '../i18n/index.js';
import { Field, Spinner, useErrorText, useToast } from '../ui.jsx';

export function LangSwitch() {
  const { i18n } = useTranslation();
  const { setLocale } = useAuth();
  return (
    <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
      {LANGUAGES.map((l) => (
        <button key={l.code} className={`chip ${i18n.language === l.code ? 'active' : ''}`} onClick={() => setLocale(l.code)}>
          {l.flag} {l.label}
        </button>
      ))}
    </div>
  );
}

function AuthShell({ title, sub, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-card stack">
        <div className="center stack-sm" style={{ alignItems: 'center' }}>
          <div className="brand-logo" style={{ width: 60, height: 60, borderRadius: 18 }}><GraduationCap size={32} /></div>
          <h1 className="mt-2">{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        <div className="card stack" style={{ padding: 22 }}>{children}</div>
        {footer && <div className="center small">{footer}</div>}
        <LangSwitch />
      </div>
    </div>
  );
}

const PwInput = (props) => (
  <div className="input-icon">
    <Lock size={18} />
    <input className="input" type="password" autoComplete="new-password" minLength={8} required {...props} />
  </div>
);

export function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const errText = useErrorText();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(form.email, form.password);
      nav(params.get('next') || '/', { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    await api.post('/auth/resend-verification', { email: form.email }).catch(() => {});
    toast.success(t('auth.verificationResent'));
  };

  return (
    <AuthShell
      title={t('auth.welcome')}
      sub={t('auth.loginSub')}
      footer={<>{t('auth.noAccount')} <Link to="/register" className="bold">{t('auth.register')}</Link></>}
    >
      <form className="stack" onSubmit={submit}>
        <Field label={t('auth.email')}>
          <div className="input-icon">
            <Mail size={18} />
            <input className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
        </Field>
        <Field label={t('auth.password')}>
          <div className="input-icon">
            <Lock size={18} />
            <input className="input" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        </Field>
        <div className="right"><Link to="/forgot-password" className="small bold">{t('auth.forgot')}</Link></div>
        {err && (
          <div className="form-error stack-sm">
            <span>{errText(err)}</span>
            {err.code === 'EMAIL_NOT_VERIFIED' && (
              <button type="button" className="btn btn-sm" onClick={resend}>{t('auth.resendVerification')}</button>
            )}
          </div>
        )}
        <button className="btn btn-gradient btn-lg btn-block" disabled={busy}>{busy ? <Spinner small /> : t('auth.login')}</button>
      </form>
    </AuthShell>
  );
}

function CheckEmail({ email, title, desc }) {
  const { t } = useTranslation();
  const toast = useToast();
  return (
    <div className="center stack" style={{ alignItems: 'center' }}>
      <div className="empty-ic tone-green" style={{ margin: 0 }}><MailCheck size={32} /></div>
      <h2>{title || t('auth.checkEmail')}</h2>
      <p className="muted">{desc || t('auth.checkEmailDesc', { email })}</p>
      {email && (
        <button
          className="btn btn-soft"
          onClick={async () => {
            await api.post('/auth/resend-verification', { email }).catch(() => {});
            toast.success(t('auth.verificationResent'));
          }}
        >
          {t('auth.resendVerification')}
        </button>
      )}
      <Link to="/login" className="bold small">{t('auth.backToLogin')}</Link>
    </div>
  );
}

export function Register() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const errText = useErrorText();
  const nav = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', accountType: 'teacher' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await register(form);
      if (r.pending) setPending(r.email);
      else nav('/', { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <AuthShell title={t('auth.registerTitle')}>
        <CheckEmail email={pending} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t('auth.registerTitle')}
      sub={t('auth.registerSub')}
      footer={<>{t('auth.haveAccount')} <Link to="/login" className="bold">{t('auth.login')}</Link></>}
    >
      <form className="stack" onSubmit={submit}>
        <div className="seg">
          <button type="button" className={form.accountType === 'teacher' ? 'active' : ''} onClick={() => setForm({ ...form, accountType: 'teacher' })}>
            <School size={17} /> {t('auth.iAmTeacher')}
          </button>
          <button type="button" className={form.accountType === 'student' ? 'active' : ''} onClick={() => setForm({ ...form, accountType: 'student' })}>
            <BookOpenCheck size={17} /> {t('auth.iAmStudent')}
          </button>
        </div>
        <Field label={t('auth.fullName')}>
          <div className="input-icon">
            <User size={18} />
            <input className="input" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
        </Field>
        <Field label={t('auth.email')}>
          <div className="input-icon">
            <Mail size={18} />
            <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
        </Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
          <PwInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {err && <div className="form-error">{errText(err)}</div>}
        <button className="btn btn-gradient btn-lg btn-block" disabled={busy}>{busy ? <Spinner small /> : t('auth.createAccount')}</button>
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    await api.post('/auth/forgot-password', { email }).catch(() => {});
    setBusy(false);
    setSent(true);
  };
  return (
    <AuthShell title={t('auth.forgotTitle')} sub={!sent && t('auth.forgotSub')}>
      {sent ? (
        <CheckEmail title={t('auth.checkEmail')} desc={t('auth.resetSentDesc', { email })} />
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label={t('auth.email')}>
            <div className="input-icon">
              <Mail size={18} />
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </Field>
          <button className="btn btn-gradient btn-lg btn-block" disabled={busy}>{busy ? <Spinner small /> : t('auth.sendResetLink')}</button>
          <Link to="/login" className="center bold small">{t('auth.backToLogin')}</Link>
        </form>
      )}
    </AuthShell>
  );
}

function ResultState({ ok, title, desc, action }) {
  return (
    <div className="center stack" style={{ alignItems: 'center' }}>
      <div className={`empty-ic ${ok ? 'tone-green' : 'tone-red'}`} style={{ margin: 0 }}>
        {ok ? <CheckCircle2 size={32} /> : <XCircle size={32} />}
      </div>
      <h2>{title}</h2>
      {desc && <p className="muted">{desc}</p>}
      {action}
    </div>
  );
}

/** Đặt lại mật khẩu (quên mật khẩu) hoặc đặt mật khẩu lần đầu (tài khoản do admin tạo). */
export function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { loginWithToken } = useAuth();
  const errText = useErrorText();
  const nav = useNavigate();
  const [pw, setPw] = useState({ a: '', b: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const token = params.get('token');

  const submit = async (e) => {
    e.preventDefault();
    if (pw.a !== pw.b) return setErr({ code: 'PASSWORD_MISMATCH' });
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post('/auth/reset-password', { token, password: pw.a });
      await loginWithToken(r.token);
      nav('/', { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title={t('auth.resetTitle')} sub={t('auth.resetSub')}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')}>
          <PwInput value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
        </Field>
        <Field label={t('auth.confirmPassword')}>
          <PwInput value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
        </Field>
        {err && <div className="form-error">{errText(err)}</div>}
        {err?.code === 'TOKEN_INVALID' && <Link to="/forgot-password" className="center bold small">{t('auth.requestNewLink')}</Link>}
        <button className="btn btn-gradient btn-lg btn-block" disabled={busy || !token}>{busy ? <Spinner small /> : t('auth.savePassword')}</button>
      </form>
    </AuthShell>
  );
}

/** Tự gọi API xác nhận token một lần khi mở trang (dùng cho link trong email). */
function useTokenAction(path) {
  const [params] = useSearchParams();
  const { loginWithToken } = useAuth();
  const [state, setState] = useState({ loading: true, error: null });
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    api
      .post(path, { token: params.get('token') || '' })
      .then(async (r) => {
        if (r.token) await loginWithToken(r.token);
        setState({ loading: false, error: null });
      })
      .catch((error) => setState({ loading: false, error }));
  }, [path, params, loginWithToken]);
  return state;
}

export function VerifyEmail() {
  const { t } = useTranslation();
  const errText = useErrorText();
  const { loading, error } = useTokenAction('/auth/verify-email');
  return (
    <AuthShell title={t('auth.verifyTitle')}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ResultState ok={false} title={t('auth.verifyFailed')} desc={errText(error)} action={<Link to="/login" className="btn btn-soft">{t('auth.backToLogin')}</Link>} />
      ) : (
        <ResultState ok title={t('auth.verifySuccess')} desc={t('auth.verifySuccessDesc')} action={<Link to="/" className="btn btn-gradient">{t('auth.start')}</Link>} />
      )}
    </AuthShell>
  );
}

export function ConfirmPasswordChange() {
  const { t } = useTranslation();
  const errText = useErrorText();
  const { loading, error } = useTokenAction('/auth/confirm-password-change');
  return (
    <AuthShell title={t('auth.confirmChangeTitle')}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ResultState ok={false} title={t('auth.confirmChangeFailed')} desc={errText(error)} action={<Link to="/settings" className="btn btn-soft">{t('nav.settings')}</Link>} />
      ) : (
        <ResultState ok title={t('auth.passwordChanged')} desc={t('auth.passwordChangedDesc')} action={<Link to="/" className="btn btn-gradient">{t('auth.start')}</Link>} />
      )}
    </AuthShell>
  );
}

/** Bắt buộc đổi mật khẩu (vd. tài khoản admin mặc định lần đầu đăng nhập). */
export function ForceChangePassword() {
  const { t } = useTranslation();
  const { loginWithToken, logout, user } = useAuth();
  const errText = useErrorText();
  const [f, setF] = useState({ current: '', a: '', b: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (f.a !== f.b) return setErr({ code: 'PASSWORD_MISMATCH' });
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post('/auth/change-password', { currentPassword: f.current, newPassword: f.a });
      if (r.token) await loginWithToken(r.token);
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title={t('auth.forceChangeTitle')} sub={t('auth.forceChangeSub', { email: user.email })} footer={<button className="btn btn-ghost" onClick={logout}>{t('auth.logout')}</button>}>
      <form className="stack" onSubmit={submit}>
        <Field label={t('auth.currentPassword')}>
          <div className="input-icon">
            <KeyRound size={18} />
            <input className="input" type="password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          </div>
        </Field>
        <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')}>
          <PwInput value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} />
        </Field>
        <Field label={t('auth.confirmPassword')}>
          <PwInput value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} />
        </Field>
        {err && <div className="form-error">{errText(err)}</div>}
        <button className="btn btn-gradient btn-lg btn-block" disabled={busy}>{busy ? <Spinner small /> : t('auth.savePassword')}</button>
      </form>
    </AuthShell>
  );
}
