import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, ErrorBox, Spinner, useApi, useErrorText, useToast } from '../ui.jsx';

export default function Invite() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { refresh, switchWorkspace, user } = useAuth();
  const { data, error, loading } = useApi(`/workspaces/invites/${token}`);
  const toast = useToast();
  const errText = useErrorText();
  const nav = useNavigate();

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const accept = async () => {
    try {
      const r = await api.post(`/workspaces/invites/${token}/accept`);
      await refresh();
      switchWorkspace(r.workspace_id);
      toast.success(t('invite.accepted'));
      nav('/');
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const decline = async () => {
    await api.post(`/workspaces/invites/${token}/decline`).catch(() => {});
    await refresh();
    nav('/workspaces');
  };
  const mismatch = data.email && data.email.toLowerCase() !== user.email.toLowerCase();

  return (
    <div className="card stack center" style={{ maxWidth: 480, margin: '24px auto', alignItems: 'center' }}>
      <div className="empty-ic"><Building2 size={30} /></div>
      <h2>{t('invite.title')}</h2>
      <p className="muted">{t('invite.desc', { name: data.workspace_name, role: data.role_name })}</p>
      {mismatch && <div className="form-error">{t('errors.INVITE_EMAIL_MISMATCH')} ({data.email})</div>}
      <div className="row">
        <AsyncButton className="btn" onClick={decline}>{t('invite.decline')}</AsyncButton>
        <AsyncButton className="btn btn-primary" onClick={accept} disabled={mismatch}>{t('invite.accept')}</AsyncButton>
      </div>
    </div>
  );
}
