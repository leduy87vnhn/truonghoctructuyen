import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { BookOpen, Copy, ExternalLink, FileText, Link2, NotebookPen, Paperclip, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Badge, Empty, ErrorBox, Field, fmtDate, Modal, PageHead, Spinner, useApi, useConfirm, useErrorText, useToast } from '../ui.jsx';
import { CopyToModal } from './Questions.jsx';

const TYPES = ['lesson_plan', 'note', 'link', 'file'];
const ICONS = { lesson_plan: NotebookPen, note: FileText, link: Link2, file: Paperclip };

export default function Materials() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [type, setType] = useState('');
  const { data, loading, error, reload } = useApi(`/materials${type ? `?type=${type}` : ''}`, [type]);
  const classes = useApi('/classes');
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [copying, setCopying] = useState(null);
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();

  const save = async () => {
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => v && fd.append(k, v));
      if (form.type === 'file' && file) fd.append('file', file);
      await api.upload('/materials', fd);
      toast.success(t('common.saved'));
      setForm(null);
      setFile(null);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remove = async (m) => {
    if (!(await confirm({ message: t('materials.deleteConfirm'), danger: true }))) return;
    await api.del(`/materials/${m.id}`);
    reload();
  };

  return (
    <div className="stack">
      <PageHead title={t('nav.teaching')} sub={t('materials.sub')}
        actions={can('material.manage') && <button className="btn btn-primary" onClick={() => setForm({ type: 'lesson_plan', title: '', content: '', url: '', classId: '' })}><Plus size={18} /> {t('materials.add')}</button>} />
      <div className="chips">
        <button className={`chip ${!type ? 'active' : ''}`} onClick={() => setType('')}>{t('common.all')}</button>
        {TYPES.map((ty) => <button key={ty} className={`chip ${type === ty ? 'active' : ''}`} onClick={() => setType(ty)}>{t(`materials.type.${ty}`)}</button>)}
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={BookOpen} title={t('materials.empty')} desc={t('materials.emptyDesc')} />
      ) : (
        <div className="grid-cards">
          {data.map((m) => {
            const Icon = ICONS[m.type];
            return (
              <div key={m.id} className="card stack-sm">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="stat-ic tone-green"><Icon size={18} /></div>
                  <div className="grow clickable" onClick={() => (m.type === 'link' ? window.open(m.url, '_blank') : m.type === 'file' ? window.open(m.file_url, '_blank') : setViewing(m))}>
                    <div className="bold">{m.title}</div>
                    <div className="xs muted">{t(`materials.type.${m.type}`)} · {fmtDate(m.updated_at, i18n.language)} · {m.created_by_name}</div>
                  </div>
                </div>
                {m.class_name && <Badge tone="primary">{m.class_name}</Badge>}
                {m.content && <div className="small muted" style={{ maxHeight: 60, overflow: 'hidden' }}>{m.content.slice(0, 160)}</div>}
                <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                  {(m.url || m.file_url) && <a className="btn btn-ghost btn-sm" href={m.url || m.file_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>}
                  {can('content.share') && <button className="btn btn-ghost btn-sm" onClick={() => setCopying(m)}><Copy size={15} /></button>}
                  {can('material.manage') && <button className="btn btn-ghost btn-sm" onClick={() => remove(m)}><Trash2 size={15} color="var(--red)" /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={t('materials.add')}>
        {form && (
          <div className="stack">
            <div className="chips">
              {TYPES.map((ty) => <button key={ty} className={`chip ${form.type === ty ? 'active' : ''}`} onClick={() => setForm({ ...form, type: ty })}>{t(`materials.type.${ty}`)}</button>)}
            </div>
            <Field label={t('materials.title')}><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label={t('materials.class')}>
              <select className="select" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                <option value="">— {t('materials.noClass')} —</option>
                {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {['note', 'lesson_plan'].includes(form.type) && (
              <Field label={t('materials.content')} hint={t('materials.markdownHint')}><textarea className="textarea" style={{ minHeight: 160 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
            )}
            {form.type === 'link' && <Field label="URL"><input className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></Field>}
            {form.type === 'file' && <Field label={t('materials.file')} hint={t('materials.fileHint')}><input className="input" type="file" onChange={(e) => setFile(e.target.files[0])} /></Field>}
            <div className="modal-foot">
              <button className="btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <AsyncButton className="btn btn-primary" onClick={save} disabled={!form.title.trim() || (form.type === 'file' && !file) || (form.type === 'link' && !form.url)}>{t('common.save')}</AsyncButton>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title} size="lg">
        <div className="markdown"><ReactMarkdown>{viewing?.content || ''}</ReactMarkdown></div>
      </Modal>
      <CopyToModal open={!!copying} onClose={() => setCopying(null)} onCopy={async (wsId) => {
        try {
          await api.post(`/materials/${copying.id}/copy-to`, { workspaceId: wsId });
          toast.success(t('share.copied'));
          setCopying(null);
        } catch (e) {
          toast.error(errText(e));
        }
      }} />
    </div>
  );
}
