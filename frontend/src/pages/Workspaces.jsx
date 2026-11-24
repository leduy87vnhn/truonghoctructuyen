import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, Check, Mail, Plus, School, User } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Badge, colorFor, Empty, Field, initials, Modal, PageHead, useErrorText, useToast } from '../ui.jsx';
import { wsLabel } from '../layout/AppLayout.jsx';

export default function Workspaces() {
  const { t } = useTranslation();
  const { workspaces, workspace, switchWorkspace, invites, refresh, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', orgKind: 'school' });
  const toast = useToast();
  const errText = useErrorText();
  const nav = useNavigate();
  const staff = workspaces.filter((w) => !['student', 'parent'].includes(w.role_key));

  const create = async () => {
    try {
      const ws = await api.post('/workspaces', form);
      await refresh();
      switchWorkspace(ws.id);
      setOpen(false);
      toast.success(t('workspace.created'));
      nav('/');
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="stack">
      <PageHead
        title={t('nav.workspaces')}
        sub={t('workspace.pageSub')}
        actions={user.account_type === 'teacher' && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={18} /> {t('workspace.createOrg')}</button>}
      />

      {invites.length > 0 && (
        <div className="card stack-sm">
          <h3 className="row"><Mail size={18} color="var(--orange)" /> {t('workspace.pendingInvites')}</h3>
          {invites.map((i) => (
            <div key={i.token} className="list-item">
              <div className="grow">
                <div className="bold">{i.workspace_name}</div>
                <div className="small muted">{i.role_name}</div>
              </div>
              <button className="btn btn-soft btn-sm" onClick={() => nav(`/invite/${i.token}`)}>{t('workspace.viewInvite')}</button>
            </div>
          ))}
        </div>
      )}

      {staff.length === 0 ? (
        <Empty icon={Building2} title={t('workspace.none')} />
      ) : (
        <div className="grid-cards">
          {staff.map((w) => (
            <div key={w.id} className="card clickable" onClick={() => { switchWorkspace(w.id); nav('/'); }}>
              <div className="row">
                <div className="class-chip" style={{ background: w.type === 'personal' ? 'var(--gradient)' : colorFor(w.name) }}>
                  {w.type === 'personal' ? <User size={20} /> : initials(w.name)}
                </div>
                <div className="grow">
                  <div className="bold truncate">{wsLabel(w, t)}</div>
                  <div className="small muted">{w.type === 'personal' ? t('workspace.personalDesc') : t(`workspace.kind.${w.org_kind}`)}</div>
                </div>
                {workspace?.id === w.id && <Check color="var(--primary)" />}
              </div>
              <div className="mt-3"><Badge tone="primary">{t(`roles.${w.role_key}`, { defaultValue: w.role_name })}</Badge></div>
            </div>
          ))}
        </div>
      )}
      <div className="card-flat small muted">{t('workspace.isolationNote')}</div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('workspace.createOrg')}>
        <div className="stack">
          <Field label={t('workspace.orgName')}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('workspace.orgNamePh')} />
          </Field>
          <div className="seg">
            <button className={form.orgKind === 'school' ? 'active' : ''} onClick={() => setForm({ ...form, orgKind: 'school' })}><School size={17} /> {t('workspace.kind.school')}</button>
            <button className={form.orgKind === 'center' ? 'active' : ''} onClick={() => setForm({ ...form, orgKind: 'center' })}><Building2 size={17} /> {t('workspace.kind.center')}</button>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
          <AsyncButton className="btn btn-primary" onClick={create} disabled={form.name.trim().length < 2}>{t('common.create')}</AsyncButton>
        </div>
      </Modal>
    </div>
  );
}
