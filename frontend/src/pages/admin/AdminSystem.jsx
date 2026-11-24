import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Mail, Plus, ScrollText, Send, UsersRound } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { AsyncButton, Badge, ErrorBox, Field, fmtDateTime, Modal, PageHead, Spinner, StatCard, Tabs, useApi, useErrorText, useToast } from '../../ui.jsx';

function MailPanel({ stats }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const logs = useApi('/admin/email-logs');
  const [to, setTo] = useState(user.email);
  const toast = useToast();
  const errText = useErrorText();
  const test = async () => {
    try {
      const r = await api.post('/admin/test-email', { to });
      toast.success(r.configured ? t('admin.testSent') : t('admin.testLogged'));
      logs.reload();
    } catch (e) {
      toast.error(errText(e));
      logs.reload();
    }
  };
  return (
    <div className="stack">
      <div className="card stack-sm">
        <h3 className="row"><Mail size={18} /> {t('admin.mailServer')}</h3>
        {stats.mail.configured ? (
          <div className="small"><Badge tone="green">SMTP</Badge> {stats.mail.host} · {stats.mail.from}</div>
        ) : (
          <div className="form-error">{t('admin.mailNotConfigured')}</div>
        )}
        <div className="small muted">{t('admin.verification')}: <b>{stats.require_email_verification ? t('common.on') : t('common.off')}</b></div>
        <div className="row">
          <input className="input grow" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          <AsyncButton className="btn btn-primary" onClick={test}><Send size={16} /> {t('admin.sendTest')}</AsyncButton>
        </div>
      </div>
      <div className="card">
        <h3 className="mb-2">{t('admin.emailLogs')}</h3>
        {logs.loading ? <Spinner /> : (logs.data || []).length === 0 ? <p className="small muted">—</p> : (
          <div className="list">
            {logs.data.map((l) => (
              <div key={l.id} className="list-item">
                <div className="grow">
                  <div className="small bold truncate">{l.subject}</div>
                  <div className="xs muted truncate">{l.to_email} · {fmtDateTime(l.created_at, i18n.language)}</div>
                  {l.error && <div className="xs" style={{ color: 'var(--red)' }}>{l.error}</div>}
                </div>
                <Badge tone={{ sent: 'green', logged: 'gray', failed: 'red' }[l.status]}>{t(`admin.mailStatus.${l.status}`)}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrgPanel() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const orgs = useApi('/admin/workspaces');
  const [form, setForm] = useState(null);
  const [users, setUsers] = useState([]);
  const toast = useToast();
  const errText = useErrorText();
  const open = async () => {
    setForm({ name: '', orgKind: 'school', adminUserId: '' });
    const r = await api.get('/admin/users?type=teacher&status=active&limit=200');
    setUsers(r.items);
  };
  const create = async () => {
    try {
      await api.post('/admin/workspaces', form);
      toast.success(t('workspace.created'));
      setForm(null);
      orgs.reload();
      refresh();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <div className="stack">
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={open}><Plus size={18} /> {t('workspace.createOrg')}</button>
      {orgs.loading ? <Spinner /> : orgs.error ? <ErrorBox error={orgs.error} /> : (
        <div className="card list" style={{ padding: '4px 12px' }}>
          {orgs.data.length === 0 && <p className="small muted" style={{ padding: 12 }}>{t('workspace.none')}</p>}
          {orgs.data.map((o) => (
            <div key={o.id} className="list-item">
              <div className="stat-ic tone-primary"><Building2 size={18} /></div>
              <div className="grow">
                <div className="bold">{o.name}</div>
                <div className="xs muted">{t(`workspace.kind.${o.org_kind}`)} · {o.owner_name} ({o.owner_email})</div>
                <div className="xs muted">{t('org.teachers')}: {o.staff_count} · {t('org.classes')}: {o.class_count} · {t('org.students')}: {o.student_count}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={t('workspace.createOrg')}>
        {form && (
          <div className="stack">
            <Field label={t('workspace.orgName')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="seg">
              <button className={form.orgKind === 'school' ? 'active' : ''} onClick={() => setForm({ ...form, orgKind: 'school' })}>{t('workspace.kind.school')}</button>
              <button className={form.orgKind === 'center' ? 'active' : ''} onClick={() => setForm({ ...form, orgKind: 'center' })}>{t('workspace.kind.center')}</button>
            </div>
            <Field label={t('admin.orgAdmin')} hint={t('admin.orgAdminHint')}>
              <select className="select" value={form.adminUserId} onChange={(e) => setForm({ ...form, adminUserId: e.target.value })}>
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
              </select>
            </Field>
            <div className="modal-foot">
              <button className="btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <AsyncButton className="btn btn-primary" onClick={create} disabled={form.name.trim().length < 2 || !form.adminUserId}>{t('common.create')}</AsyncButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AuditPanel() {
  const { i18n } = useTranslation();
  const { data, loading } = useApi('/admin/audit-logs');
  if (loading) return <Spinner />;
  return (
    <div className="card list" style={{ padding: '4px 12px' }}>
      {(data || []).map((a) => (
        <div key={a.id} className="list-item">
          <div className="grow">
            <div className="small"><b>{a.action}</b> {a.entity && <span className="muted">· {a.entity}</span>}</div>
            <div className="xs muted">{a.user_name || '—'} · {fmtDateTime(a.created_at, i18n.language)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminSystem() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/admin/stats');
  const [tab, setTab] = useState('mail');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="stack">
      <PageHead title={t('nav.system')} sub={t('admin.systemSub')} />
      <div className="grid-2 grid-4">
        <StatCard icon={UsersRound} value={data.users} label={t('admin.users')} tone="primary" />
        <StatCard icon={UsersRound} value={data.teachers} label={t('admin.type.teacher')} tone="sky" />
        <StatCard icon={UsersRound} value={data.students} label={t('admin.type.student')} tone="green" />
        <StatCard icon={Building2} value={data.organizations} label={t('admin.organizations')} tone="orange" />
      </div>
      {data.mail_failed_7d > 0 && <div className="form-error">{t('admin.mailFailed', { n: data.mail_failed_7d })}</div>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'mail', label: 'Email', icon: Mail },
        { key: 'orgs', label: t('admin.organizations'), icon: Building2 },
        { key: 'audit', label: t('admin.audit'), icon: ScrollText },
      ]} />
      {tab === 'mail' && <MailPanel stats={data} />}
      {tab === 'orgs' && <OrgPanel />}
      {tab === 'audit' && <AuditPanel />}
    </div>
  );
}
