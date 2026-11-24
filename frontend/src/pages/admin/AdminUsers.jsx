import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Mail, MoreVertical, Pencil, Search, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { AsyncButton, Avatar, Badge, Empty, ErrorBox, Field, fmtDateTime, Modal, PageHead, Spinner, useApi, useConfirm, useErrorText, useToast } from '../../ui.jsx';

const TYPES = ['teacher', 'student', 'parent'];
const STATUS_TONE = { active: 'green', pending: 'yellow', disabled: 'red' };
const PAGE = 30;

function UserForm({ open, onClose, user, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errText = useErrorText();
  const orgs = useApi(open && !user ? '/admin/workspaces' : null, [open]);
  const [f, setF] = useState(null);
  const [key, setKey] = useState(null);
  const k = open ? user?.id || 'new' : null;
  if (k !== key) {
    setKey(k);
    if (open) {
      setF(user
        ? { fullName: user.full_name, email: user.email, accountType: user.account_type, status: user.status, isSystemAdmin: user.is_system_admin, phone: user.phone || '' }
        : { fullName: '', email: '', accountType: 'teacher', isSystemAdmin: false, mode: 'email', password: '', mustChangePassword: true, organizationId: '', organizationRole: 'teacher', locale: 'vi' });
    }
  }
  if (!open || !f) return null;
  const set = (patch) => setF({ ...f, ...patch });

  const save = async () => {
    try {
      if (user) {
        const body = { fullName: f.fullName, email: f.email, accountType: f.accountType, isSystemAdmin: f.isSystemAdmin, phone: f.phone || null };
        if (f.status !== user.status && f.status !== 'pending') body.status = f.status;
        await api.patch(`/admin/users/${user.id}`, body);
        toast.success(t('common.saved'));
      } else {
        const body = { ...f, organizationId: f.organizationId || null, organizationRole: f.organizationId ? f.organizationRole : null, password: f.mode === 'password' ? f.password : undefined };
        const r = await api.post('/admin/users', body);
        toast.success(f.mode === 'email' ? (r.mail_sent ? t('admin.userCreatedMail') : t('admin.userCreatedMailFailed')) : t('admin.userCreated'));
      }
      onSaved();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={user ? t('admin.editUser') : t('admin.createUser')}>
      <div className="stack">
        <Field label={t('auth.fullName')}><input className="input" value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label={t('admin.accountType')}>
          <div className="chips">{TYPES.map((ty) => <button key={ty} className={`chip ${f.accountType === ty ? 'active' : ''}`} onClick={() => set({ accountType: ty })}>{t(`admin.type.${ty}`)}</button>)}</div>
        </Field>
        {user && (
          <Field label={t('admin.status')}>
            <select className="select" value={f.status} onChange={(e) => set({ status: e.target.value })}>
              {user.status === 'pending' && <option value="pending">{t('admin.statusLabel.pending')}</option>}
              <option value="active">{t('admin.statusLabel.active')}</option>
              <option value="disabled">{t('admin.statusLabel.disabled')}</option>
            </select>
          </Field>
        )}
        {f.accountType === 'teacher' && (
          <label className="check"><input type="checkbox" checked={f.isSystemAdmin} onChange={(e) => set({ isSystemAdmin: e.target.checked })} /> <ShieldCheck size={16} /> {t('admin.isSystemAdmin')}</label>
        )}
        {!user && (
          <>
            <Field label={t('admin.passwordMode')}>
              <div className="seg">
                <button className={f.mode === 'email' ? 'active' : ''} onClick={() => set({ mode: 'email' })}><Mail size={16} /> {t('admin.modeEmail')}</button>
                <button className={f.mode === 'password' ? 'active' : ''} onClick={() => set({ mode: 'password' })}><KeyRound size={16} /> {t('admin.modePassword')}</button>
              </div>
            </Field>
            {f.mode === 'email' ? <p className="xs muted">{t('admin.modeEmailHint')}</p> : (
              <>
                <Field label={t('admin.tempPassword')} hint={t('auth.passwordHint')}><input className="input" type="text" value={f.password} onChange={(e) => set({ password: e.target.value })} /></Field>
                <label className="check"><input type="checkbox" checked={f.mustChangePassword} onChange={(e) => set({ mustChangePassword: e.target.checked })} /> {t('admin.mustChange')}</label>
              </>
            )}
            {f.accountType === 'teacher' && (orgs.data || []).length > 0 && (
              <div className="grid-2">
                <Field label={t('admin.addToOrg')}>
                  <select className="select" value={f.organizationId} onChange={(e) => set({ organizationId: e.target.value })}>
                    <option value="">—</option>
                    {orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
                {f.organizationId && (
                  <Field label={t('org.role')}>
                    <select className="select" value={f.organizationRole} onChange={(e) => set({ organizationRole: e.target.value })}>
                      {['org_admin', 'academic_manager', 'teacher', 'assistant'].map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            )}
          </>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <AsyncButton className="btn btn-primary" onClick={save} disabled={!f.fullName.trim() || !f.email.includes('@') || (!user && f.mode === 'password' && f.password.length < 8)}>{t('common.save')}</AsyncButton>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminUsers() {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const [filters, setFilters] = useState({ q: '', type: '', status: '' });
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const qs = new URLSearchParams({ ...(search && { q: search }), ...(filters.type && { type: filters.type }), ...(filters.status && { status: filters.status }), limit: PAGE, offset }).toString();
  const { data, loading, error, reload } = useApi(`/admin/users?${qs}`, [qs]);
  const [form, setForm] = useState(null);
  const [menu, setMenu] = useState(null);
  const [pwFor, setPwFor] = useState(null);
  const [pw, setPw] = useState({ password: '', mustChangePassword: true });
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();

  const act = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast.success(msg);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="stack">
      <PageHead title={t('nav.users')} sub={data ? t('admin.totalUsers', { n: data.total }) : ''}
        actions={<button className="btn btn-primary" onClick={() => setForm('new')}><UserPlus size={18} /> {t('admin.createUser')}</button>} />
      <form className="input-icon" onSubmit={(e) => { e.preventDefault(); setOffset(0); setSearch(filters.q); }}>
        <Search size={18} />
        <input className="input" placeholder={t('admin.searchUsers')} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onBlur={() => { setOffset(0); setSearch(filters.q); }} />
      </form>
      <div className="chips">
        <button className={`chip ${!filters.type ? 'active' : ''}`} onClick={() => { setOffset(0); setFilters({ ...filters, type: '' }); }}>{t('common.all')}</button>
        {TYPES.map((ty) => <button key={ty} className={`chip ${filters.type === ty ? 'active' : ''}`} onClick={() => { setOffset(0); setFilters({ ...filters, type: ty }); }}>{t(`admin.type.${ty}`)}</button>)}
        <span style={{ width: 8 }} />
        {['pending', 'disabled'].map((s) => <button key={s} className={`chip ${filters.status === s ? 'active' : ''}`} onClick={() => { setOffset(0); setFilters({ ...filters, status: filters.status === s ? '' : s }); }}>{t(`admin.statusLabel.${s}`)}</button>)}
      </div>

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.items.length === 0 ? (
        <Empty icon={UsersRound} title={t('admin.noUsers')} />
      ) : (
        <div className="card list" style={{ padding: '4px 12px' }}>
          {data.items.map((u) => (
            <div key={u.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <Avatar name={u.full_name} />
              <div className="grow">
                <div className="bold truncate">{u.full_name} {u.id === me.id && <span className="xs muted">({t('admin.you')})</span>}</div>
                <div className="small muted truncate">{u.email}</div>
                <div className="row-wrap mt-1">
                  <Badge tone={STATUS_TONE[u.status]}>{t(`admin.statusLabel.${u.status}`)}</Badge>
                  <Badge tone="primary">{t(`admin.type.${u.account_type}`)}</Badge>
                  {u.is_system_admin && <Badge tone="pink"><ShieldCheck size={11} /> Admin</Badge>}
                  {u.must_change_password && <Badge tone="yellow">{t('admin.mustChangeBadge')}</Badge>}
                  {(u.organizations || []).map((o) => <Badge key={o.name}>{o.name}</Badge>)}
                </div>
                <div className="xs muted mt-1">{t('admin.lastLogin')}: {u.last_login_at ? fmtDateTime(u.last_login_at, i18n.language) : '—'}</div>
              </div>
              <div className="dropdown">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMenu(menu === u.id ? null : u.id)}><MoreVertical size={18} /></button>
                {menu === u.id && (
                  <div className="menu" onMouseLeave={() => setMenu(null)}>
                    <button onClick={() => { setMenu(null); setForm(u); }}><Pencil size={16} /> {t('common.edit')}</button>
                    {u.status !== 'disabled' && <button onClick={() => { setMenu(null); act(() => api.post(`/admin/users/${u.id}/send-reset`), t('admin.resetSent')); }}><Mail size={16} /> {u.status === 'pending' ? t('admin.resendInvite') : t('admin.sendReset')}</button>}
                    <button onClick={() => { setMenu(null); setPw({ password: '', mustChangePassword: true }); setPwFor(u); }}><KeyRound size={16} /> {t('admin.setPassword')}</button>
                    {u.id !== me.id && (
                      <button style={{ color: 'var(--red)' }} onClick={async () => {
                        setMenu(null);
                        if (await confirm({ message: t('admin.deleteConfirm', { email: u.email }), danger: true })) act(() => api.del(`/admin/users/${u.id}`), t('common.deleted'));
                      }}><Trash2 size={16} /> {t('common.delete')}</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && data.total > PAGE && (
        <div className="row between">
          <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('common.prev')}</button>
          <span className="small muted">{offset + 1}–{Math.min(offset + PAGE, data.total)} / {data.total}</span>
          <button className="btn btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>{t('common.next')}</button>
        </div>
      )}

      <UserForm open={!!form} user={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />
      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`${t('admin.setPassword')} · ${pwFor?.email}`}>
        <div className="stack">
          <Field label={t('auth.newPassword')} hint={t('auth.passwordHint')}><input className="input" type="text" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={pw.mustChangePassword} onChange={(e) => setPw({ ...pw, mustChangePassword: e.target.checked })} /> {t('admin.mustChange')}</label>
          <div className="modal-foot">
            <button className="btn" onClick={() => setPwFor(null)}>{t('common.cancel')}</button>
            <AsyncButton className="btn btn-primary" disabled={pw.password.length < 8} onClick={() => act(async () => { await api.post(`/admin/users/${pwFor.id}/set-password`, pw); setPwFor(null); }, t('common.saved'))}>{t('common.save')}</AsyncButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
