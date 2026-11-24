import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileQuestion, MoreVertical, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Empty, ErrorBox, Field, Modal, PageHead, Spinner, useApi, useConfirm, useErrorText, useToast } from '../ui.jsx';
import { emptyQuestion, fromApi, QTYPES, QuestionEditor, QuestionView, toPayload, validateQuestion } from './QuestionEditor.jsx';

/** Chọn không gian đích để sao chép học liệu */
export function CopyToModal({ open, onClose, onCopy }) {
  const { t } = useTranslation();
  const { workspaces, workspace } = useAuth();
  const targets = workspaces.filter((w) => w.id !== workspace?.id && (w.permissions || []).includes('exam.manage'));
  return (
    <Modal open={open} onClose={onClose} title={t('share.copyTo')}>
      <p className="small muted mb-3">{t('share.copyDesc')}</p>
      {targets.length === 0 ? <p className="muted">{t('share.noTargets')}</p> : (
        <div className="stack-sm">
          {targets.map((w) => (
            <AsyncButton key={w.id} className="btn btn-block" style={{ justifyContent: 'flex-start' }} onClick={() => onCopy(w.id)}>
              {w.type === 'personal' ? t('workspace.personal') : w.name}
            </AsyncButton>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function AIQuestionsModal({ open, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errText = useErrorText();
  const [f, setF] = useState({ subject: '', gradeLevel: '', topic: '', type: 'single_choice', count: 5, difficulty: 'medium', notes: '' });
  const [drafts, setDrafts] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post('/ai/generate-questions', { ...f, count: Number(f.count), subject: f.subject || null, gradeLevel: f.gradeLevel || null, notes: f.notes || null });
      setDrafts(r.questions);
      setSelected(Object.fromEntries(r.questions.map((_, i) => [i, true])));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const qs = drafts.filter((_, i) => selected[i]).map((q) => toPayload(fromApi(q)));
    try {
      const r = await api.post('/questions/bulk', { questions: qs });
      toast.success(t('questions.savedN', { n: r.created }));
      setDrafts(null);
      onSaved();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={<span className="row"><Sparkles size={20} color="var(--primary)" /> {t('ai.generateQuestions')}</span>} size="lg">
      {!drafts ? (
        <div className="stack">
          <Field label={t('ai.topic')}><input className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder={t('ai.topicPh')} /></Field>
          <div className="grid-2">
            <Field label={t('common.subject')}><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
            <Field label={t('common.gradeLevel')}><input className="input" value={f.gradeLevel} onChange={(e) => setF({ ...f, gradeLevel: e.target.value })} /></Field>
          </div>
          <Field label={t('questions.type')}>
            <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {QTYPES.map((q) => <option key={q} value={q}>{t(`qtype.${q}`)}</option>)}
            </select>
          </Field>
          <div className="grid-2">
            <Field label={t('ai.count')}><input className="input" type="number" min="1" max="20" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
            <Field label={t('questions.difficulty')}>
              <select className="select" value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>
                {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{t(`difficulty.${d}`)}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t('ai.notes')}><textarea className="textarea" style={{ minHeight: 60 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <button className="btn btn-gradient btn-lg" onClick={generate} disabled={busy || f.topic.trim().length < 2}>
            {busy ? <><Spinner small /> {t('ai.generating')}</> : <><Sparkles size={18} /> {t('ai.generate')}</>}
          </button>
        </div>
      ) : (
        <div className="stack">
          <p className="small muted">{t('ai.reviewHint')}</p>
          {drafts.map((q, i) => (
            <label key={i} className="card-flat row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!selected[i]} onChange={(e) => setSelected({ ...selected, [i]: e.target.checked })} style={{ width: 20, height: 20, accentColor: 'var(--primary)' }} />
              <div className="grow"><QuestionView q={q} index={i + 1} points={q.points} /></div>
            </label>
          ))}
          <div className="modal-foot">
            <button className="btn" onClick={() => setDrafts(null)}>{t('ai.regenerate')}</button>
            <AsyncButton className="btn btn-primary" onClick={save} disabled={!Object.values(selected).some(Boolean)}>{t('questions.saveSelected')}</AsyncButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Questions() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [filters, setFilters] = useState({ q: '', type: '' });
  const [search, setSearch] = useState('');
  const qs = new URLSearchParams({ ...(search && { q: search }), ...(filters.type && { type: filters.type }) }).toString();
  const { data, loading, error, reload } = useApi(`/questions${qs ? `?${qs}` : ''}`, [qs]);
  const [editing, setEditing] = useState(null); // {id?, form}
  const [aiOpen, setAiOpen] = useState(false);
  const [copying, setCopying] = useState(null);
  const [menu, setMenu] = useState(null);
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();
  const canEdit = can('question.manage');

  const save = async () => {
    const bad = validateQuestion(editing.form);
    if (bad) return toast.error(t(`questions.invalid.${bad}`));
    try {
      if (editing.id) {
        const r = await api.put(`/questions/${editing.id}`, toPayload(editing.form));
        toast.success(t('questions.newVersion', { v: r.version }));
      } else {
        await api.post('/questions', toPayload(editing.form));
        toast.success(t('common.saved'));
      }
      setEditing(null);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remove = async (q) => {
    if (!(await confirm({ message: t('questions.deleteConfirm'), danger: true }))) return;
    await api.del(`/questions/${q.id}`);
    reload();
  };

  return (
    <div className="stack">
      <PageHead
        title={t('nav.questionBank')}
        sub={t('questions.sub')}
        actions={canEdit && (
          <>
            {can('ai.use') && <button className="btn btn-soft" onClick={() => setAiOpen(true)}><Sparkles size={18} /> {t('ai.generateQuestions')}</button>}
            <button className="btn btn-primary" onClick={() => setEditing({ form: emptyQuestion() })}><Plus size={18} /> {t('questions.create')}</button>
          </>
        )}
      />
      <form className="input-icon" onSubmit={(e) => { e.preventDefault(); setSearch(filters.q); }}>
        <Search size={18} />
        <input className="input" placeholder={t('questions.search')} value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onBlur={() => setSearch(filters.q)} />
      </form>
      <div className="chips">
        <button className={`chip ${!filters.type ? 'active' : ''}`} onClick={() => setFilters({ ...filters, type: '' })}>{t('common.all')}</button>
        {QTYPES.map((ty) => <button key={ty} className={`chip ${filters.type === ty ? 'active' : ''}`} onClick={() => setFilters({ ...filters, type: ty })}>{t(`qtype.${ty}`)}</button>)}
      </div>

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.items.length === 0 ? (
        <Empty icon={FileQuestion} title={t('questions.empty')} desc={t('questions.emptyDesc')} />
      ) : (
        <div className="stack-sm">
          <div className="small muted">{t('questions.total', { n: data.items.length })}</div>
          {data.items.map((q) => (
            <div key={q.id} className="card row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <QuestionView q={q} points={q.default_points} />
                <div className="xs muted mt-2">v{q.current_version} · {q.created_by_name}{q.used_in_exams > 0 ? ` · ${t('questions.usedIn', { n: q.used_in_exams })}` : ''}</div>
              </div>
              {canEdit && (
                <div className="dropdown">
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMenu(menu === q.id ? null : q.id)}><MoreVertical size={18} /></button>
                  {menu === q.id && (
                    <div className="menu" onMouseLeave={() => setMenu(null)}>
                      <button onClick={() => { setMenu(null); setEditing({ id: q.id, form: fromApi(q) }); }}><Pencil size={16} /> {t('common.edit')}</button>
                      {can('content.share') && <button onClick={() => { setMenu(null); setCopying(q); }}><Copy size={16} /> {t('share.copyTo')}</button>}
                      <button onClick={() => { setMenu(null); remove(q); }} style={{ color: 'var(--red)' }}><Trash2 size={16} /> {t('common.delete')}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('questions.edit') : t('questions.create')} size="lg">
        {editing && (
          <>
            {editing.id && <div className="ai-box small mb-3">{t('questions.versionNote')}</div>}
            <QuestionEditor value={editing.form} onChange={(form) => setEditing({ ...editing, form })} />
            <div className="modal-foot">
              <button className="btn" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
              <AsyncButton className="btn btn-primary" onClick={save}>{t('common.save')}</AsyncButton>
            </div>
          </>
        )}
      </Modal>
      <AIQuestionsModal open={aiOpen} onClose={() => setAiOpen(false)} onSaved={() => { setAiOpen(false); reload(); }} />
      <CopyToModal
        open={!!copying}
        onClose={() => setCopying(null)}
        onCopy={async (wsId) => {
          try {
            await api.post(`/questions/${copying.id}/copy-to`, { workspaceId: wsId });
            toast.success(t('share.copied'));
            setCopying(null);
          } catch (e) {
            toast.error(errText(e));
          }
        }}
      />
    </div>
  );
}
