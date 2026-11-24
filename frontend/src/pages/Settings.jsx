import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, LogOut, MailCheck, UserRound } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Avatar, Field, PageHead, useErrorText, useToast } from '../ui.jsx';
import { LangSwitch } from './Auth.jsx';

export default function Settings() {
  const { t } = useTranslation();
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const errText = useErrorText();
  const [profile, setProfile] = useState({ fullName: user.full_name, phone: user.phone || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pending, setPending] = useState(null);

  const saveProfile = async () => {
    try {
      await api.patch('/auth/me', { fullName: profile.fullName, phone: profile.phone || null });
      await refresh();
      toast.success(t('common.saved'));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const changePw = async () => {
    if (pw.newPassword !== pw.confirm) return toast.error(t('errors.PASSWORD_MISMATCH'));
    try {
      const r = await api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      if (r.pending) setPending(r.email);
      else toast.success(t('auth.passwordChanged'));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <PageHead title={t('nav.settings')} />
      <div className="card row">
        <Avatar name={user.full_name} />
        <div className="grow">
          <div className="bold">{user.full_name}</div>
          <div className="small muted">{user.email}</div>
        </div>
      </div>

      <div className="card stack">
        <h3 className="row"><UserRound size={18} /> {t('settings.profile')}</h3>
        <Field label={t('auth.fullName')}>
          <input className="input" value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
        </Field>
        <Field label={t('settings.phone')}>
          <input className="input" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
        </Field>
        <AsyncButton className="btn btn-primary" onClick={saveProfile}>{t('common.save')}</AsyncButton>
      </div>

      <div className="card stack">
        <h3>{t('settings.language')}</h3>
        <LangSwitch />
      </div>

      <div className="card stack">
        <h3 className="row"><KeyRound size={18} /> {t('settings.changePassword')}</h3>
        {pending ? (
          <div className="ai-box row">
            <MailCheck color="var(--green)" />
            <div className="small">{t('settings.confirmEmailSent', { email: pending })}</div>
          </div>
        ) : (
          <>
            <p className="small muted">{t('settings.changePasswordNote')}</p>
            <Field label={t('auth.currentPassword')}>
              <input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            </Field>
            <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')}>
              <input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            </Field>
            <Field label={t('auth.confirmPassword')}>
              <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <AsyncButton className="btn btn-soft" onClick={changePw} disabled={!pw.currentPassword || pw.newPassword.length < 8}>
              {t('settings.sendConfirm')}
            </AsyncButton>
          </>
        )}
      </div>

      <button className="btn btn-danger btn-block" onClick={logout}><LogOut size={18} /> {t('auth.logout')}</button>
    </div>
  );
}
