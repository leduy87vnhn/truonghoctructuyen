import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Copy, GraduationCap, KeyRound, Mail, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Avatar, Badge, ClassChip, ErrorBox, Field, Modal, PageHead, Spinner, Tabs, useApi, useConfirm, useErrorText, useToast } from '../ui.jsx';

const ROLES = ['org_admin', 'academic_manager', 'teacher', 'assistant'];

function Members() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi('/workspaces/current/members?staff=1');
  const [invite, setInvite] = useState(null);
  const [link, setLink] = useState(null);
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();
  const canManage = can('member.manage');

  const send = async () => {
    try {
      const r = await api.post('/workspaces/current/invites', invite);
      setInvite(null);
      setLink(r);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const changeRole = async (m, roleKey) => {
    try {
      await api.patch(`/workspaces/current/members/${m.id}`, { roleKey });
      toast.success(t('common.saved'));
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remove = async (m) => {
    if (!(await confirm({ message: t('org.removeConfirm', { name: m.full_name || m.invited_email }), danger: true }))) return;
    try {
      await api.del(`/workspaces/current/members/${m.id}`);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="stack">
      {canManage && <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setInvite({ email: '', roleKey: 'teacher' })}><UserPlus size={18} /> {t('org.invite')}</button>}
      <div className="card list" style={{ padding: '4px 12px' }}>
        {data.map((m) => (
          <div key={m.id} className="list-item">
            <Avatar name={m.full_name || m.invited_email} size="sm" />
            <div className="grow">
              <div className="bold truncate">{m.full_name || m.invited_email}</div>
              <div className="xs muted truncate">{m.email || m.invited_email} · {t('org.nClasses', { n: m.class_count })}</div>
              <div className="row-wrap mt-1">
                {m.status === 'invited' && <Badge tone="yellow">{t('org.invited')}</Badge>}
                {m.status === 'disabled' && <Badge tone="red">{t('org.disabled')}</Badge>}
              </div>
            </div>
            {canManage ? (
              <select className="select input-sm" style={{ width: 'auto', maxWidth: 150 }} value={m.role_key} onChange={(e) => changeRole(m, e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
              </select>
            ) : <Badge tone="primary">{t(`roles.${m.role_key}`)}</Badge>}
            {canManage && m.invite_link && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { navigator.clipboard?.writeText(m.invite_link); toast.success(t('common.copied')); }}><Copy size={15} /></button>}
            {canManage && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(m)}><Trash2 size={15} color="var(--red)" /></button>}
          </div>
        ))}
      </div>
      <Modal open={!!invite} onClose={() => setInvite(null)} title={t('org.invite')}>
        {invite && (
          <div className="stack">
            <Field label="Email"><input className="input" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
            <Field label={t('org.role')}>
              <select className="select" value={invite.roleKey} onChange={(e) => setInvite({ ...invite, roleKey: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
              </select>
            </Field>
            <p className="xs muted">{t('org.inviteHint')}</p>
            <div className="modal-foot">
              <button className="btn" onClick={() => setInvite(null)}>{t('common.cancel')}</button>
              <AsyncButton className="btn btn-primary" onClick={send} disabled={!invite.email.includes('@')}><Mail size={16} /> {t('org.sendInvite')}</AsyncButton>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!link} onClose={() => setLink(null)} title={t('org.inviteSent')}>
        <div className="stack">
          <p className="small">{link?.mail_sent ? t('org.inviteMailed') : t('org.inviteNotMailed')}</p>
          <div className="input-icon"><input className="input" readOnly value={link?.invite_link || ''} onFocus={(e) => e.target.select()} /></div>
          <button className="btn btn-soft" onClick={() => { navigator.clipboard?.writeText(link.invite_link); toast.success(t('common.copied')); }}><Copy size={16} /> {t('common.copy')}</button>
        </div>
      </Modal>
    </div>
  );
}

function ClassAssignmentsTab() {
  const { t } = useTranslation();
  const classes = useApi('/classes');
  const members = useApi('/workspaces/current/members?staff=1');
  const [pick, setPick] = useState(null);
  const toast = useToast();
  const errText = useErrorText();
  if (classes.loading || members.loading) return <Spinner />;
  if (classes.error) return <ErrorBox error={classes.error} />;
  const staff = (members.data || []).filter((m) => m.status === 'active' && m.user_id);
  const assign = async (userId, role) => {
    try {
      await api.post(`/classes/${pick.id}/teachers`, { userId, role });
      classes.reload();
      setPick(null);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const unassign = async (c, userId) => {
    await api.del(`/classes/${c.id}/teachers/${userId}`);
    classes.reload();
  };
  return (
    <div className="stack-sm">
      {classes.data.map((c) => (
        <div key={c.id} className="card row" style={{ alignItems: 'flex-start' }}>
          <ClassChip name={c.name} color={c.color} />
          <div className="grow stack-sm">
            <div className="bold">{c.name} <span className="xs muted">· {t('classes.nStudents', { n: c.student_count })}</span></div>
            <div className="row-wrap">
              {(c.teachers || []).map((tch) => (
                <span key={tch.user_id} className="chip" style={{ cursor: 'default' }}>
                  {tch.full_name} {tch.role === 'assistant' && `(${t('roles.assistant')})`}
                  <button className="btn btn-ghost btn-icon" style={{ width: 20, minHeight: 20 }} onClick={() => unassign(c, tch.user_id)}>×</button>
                </span>
              ))}
              {!(c.teachers || []).length && <Badge tone="red">{t('org.noTeacher')}</Badge>}
            </div>
          </div>
          <button className="btn btn-soft btn-sm" onClick={() => setPick(c)}><Plus size={15} /> {t('org.assign')}</button>
        </div>
      ))}
      <Modal open={!!pick} onClose={() => setPick(null)} title={`${t('org.assign')} · ${pick?.name}`}>
        <div className="list">
          {staff.map((m) => (
            <div key={m.user_id} className="list-item">
              <Avatar name={m.full_name} size="sm" />
              <div className="grow"><div className="bold small">{m.full_name}</div><div className="xs muted">{t(`roles.${m.role_key}`)}</div></div>
              <AsyncButton className="btn btn-sm" onClick={() => assign(m.user_id, 'assistant')}>{t('roles.assistant')}</AsyncButton>
              <AsyncButton className="btn btn-primary btn-sm" onClick={() => assign(m.user_id, 'main')}>{t('org.mainTeacher')}</AsyncButton>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function TeacherReport() {
  const { t } = useTranslation();
  const { data, loading, error } = useApi('/reports/org');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th className="sticky-col">{t('org.teacher')}</th><th>{t('org.classes')}</th><th>{t('nav.examBank')}</th><th>{t('nav.assigned')}</th><th>{t('stats.graded')}</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id}><td className="sticky-col"><div className="bold">{r.full_name}</div><div className="xs muted">{r.role_name}</div></td><td>{r.class_count}</td><td>{r.exam_count}</td><td>{r.assignment_count}</td><td>{r.graded_count}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgSettings() {
  const { t } = useTranslation();
  const { workspace, refresh } = useAuth();
  const roles = useApi('/workspaces/current/roles');
  const [name, setName] = useState(workspace.name);
  const [approval, setApproval] = useState(!!workspace.settings?.requireExamApproval);
  const toast = useToast();
  const save = async () => {
    await api.patch('/workspaces/current', { name, settings: { requireExamApproval: approval } });
    await refresh();
    toast.success(t('common.saved'));
  };
  return (
    <div className="stack">
      <div className="card stack">
        <Field label={t('workspace.orgName')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> {t('org.requireApproval')}</label>
        <AsyncButton className="btn btn-primary" onClick={save}>{t('common.save')}</AsyncButton>
      </div>
      <div className="card">
        <h3 className="row mb-2"><KeyRound size={18} /> {t('org.permissionMatrix')}</h3>
        {roles.loading ? <Spinner /> : roles.data && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th className="sticky-col">{t('org.permission')}</th>{roles.data.roles.map((r) => <th key={r.id}>{t(`roles.${r.key}`)}</th>)}</tr></thead>
              <tbody>
                {roles.data.permissions.map((p) => (
                  <tr key={p.key}>
                    <td className="sticky-col small">{t(`perm.${p.key}`, { defaultValue: p.description })}</td>
                    {roles.data.roles.map((r) => <td key={r.id} className="center">{r.permissions.includes(p.key) ? '✅' : ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Org() {
  const { t } = useTranslation();
  const { workspace, can } = useAuth();
  const [tab, setTab] = useState(can('member.manage') ? 'members' : 'classes');
  const { data } = useApi('/dashboard');
  if (workspace.type !== 'organization') return <ErrorBox error={{ code: 'ORG_ONLY' }} />;
  const tabs = [
    (can('member.manage') || can('class.manage_all')) && { key: 'members', label: t('org.members'), icon: Users },
    can('class.manage_all') && { key: 'classes', label: t('org.assignment'), icon: GraduationCap },
    can('report.view_org') && { key: 'report', label: t('nav.reports'), icon: Building2 },
    can('workspace.manage') && { key: 'settings', label: t('org.settings'), icon: KeyRound },
  ].filter(Boolean);
  return (
    <div className="stack">
      <PageHead title={workspace.name} sub={`${t(`workspace.kind.${workspace.org_kind}`)} · ${t('org.adminBoard')}`} />
      {data?.org && (
        <div className="grid-2 grid-4">
          <div className="card stat"><div className="stat-val">{data.org.teacher_count}</div><div className="stat-label">{t('org.teachers')}</div></div>
          <div className="card stat"><div className="stat-val">{data.org.class_count}</div><div className="stat-label">{t('org.classes')}</div></div>
          <div className="card stat"><div className="stat-val">{data.org.student_count}</div><div className="stat-label">{t('org.students')}</div></div>
          <div className="card stat"><div className="stat-val">{data.org.assignment_count}</div><div className="stat-label">{t('org.assignments')}</div></div>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'members' && <Members />}
      {tab === 'classes' && <ClassAssignmentsTab />}
      {tab === 'report' && <TeacherReport />}
      {tab === 'settings' && <OrgSettings />}
    </div>
  );
}
