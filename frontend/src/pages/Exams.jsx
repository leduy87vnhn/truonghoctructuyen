import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Copy, FileStack, MoreVertical, Plus, Search, Send, Trash2, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Badge, Empty, ErrorBox, ExamStatusBadge, Field, Modal, PageHead, Spinner, useApi, useConfirm, useErrorText, useToast } from '../ui.jsx';
import AssignModal from './AssignModal.jsx';
import { CopyToModal } from './Questions.jsx';

export function ExamInfoForm({ value: f, onChange }) {
  const { t } = useTranslation();
  const set = (k) => (e) => onChange({ ...f, [k]: e.target.value });
  return (
    <div className="stack">
      <Field label={t('exams.title')}><input className="input" value={f.title} onChange={set('title')} placeholder={t('exams.titlePh')} /></Field>
      <div className="seg">
        <button type="button" className={f.kind === 'exercise' ? 'active' : ''} onClick={() => onChange({ ...f, kind: 'exercise' })}>{t('exams.kind.exercise')}</button>
        <button type="button" className={f.kind === 'test' ? 'active' : ''} onClick={() => onChange({ ...f, kind: 'test' })}>{t('exams.kind.test')}</button>
      </div>
      <div className="grid-2">
        <Field label={t('common.subject')}><input className="input" value={f.subject} onChange={set('subject')} /></Field>
        <Field label={t('common.gradeLevel')}><input className="input" value={f.gradeLevel} onChange={set('gradeLevel')} /></Field>
      </div>
      <Field label={t('exams.duration')} hint={t('exams.durationHint')}>
        <input className="input" type="number" min="1" value={f.durationMinutes} onChange={set('durationMinutes')} />
      </Field>
      <Field label={t('common.description')}><textarea className="textarea" style={{ minHeight: 70 }} value={f.description} onChange={set('description')} /></Field>
    </div>
  );
}

export const emptyExamInfo = () => ({ title: '', kind: 'exercise', subject: '', gradeLevel: '', durationMinutes: '', description: '' });
export const examInfoPayload = (f) => ({
  title: f.title,
  kind: f.kind,
  subject: f.subject || null,
  gradeLevel: f.gradeLevel || null,
  durationMinutes: f.durationMinutes ? Number(f.durationMinutes) : null,
  description: f.description || null,
});

const STATUSES = ['', 'draft', 'pending_review', 'published'];

export default function Exams() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const qs = new URLSearchParams({ ...(status && { status }), ...(search && { q: search }) }).toString();
  const { data, loading, error, reload } = useApi(`/exams${qs ? `?${qs}` : ''}`, [qs]);
  const [info, setInfo] = useState(emptyExamInfo());
  const [assigning, setAssigning] = useState(null);
  const [copying, setCopying] = useState(null);
  const [menu, setMenu] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();
  const creating = params.get('new') === '1';

  const create = async () => {
    try {
      const e = await api.post('/exams', examInfoPayload(info));
      nav(`/exams/${e.id}?step=source`);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const duplicate = async (e) => {
    const r = await api.post(`/exams/${e.id}/duplicate`);
    toast.success(t('exams.duplicated'));
    nav(`/exams/${r.id}`);
  };
  const remove = async (e) => {
    if (!(await confirm({ message: t('exams.deleteConfirm'), danger: true }))) return;
    try {
      const r = await api.del(`/exams/${e.id}`);
      toast.success(r.archived ? t('exams.archivedMsg') : t('common.deleted'));
      reload();
    } catch (err) {
      toast.error(errText(err));
    }
  };

  return (
    <div className="stack">
      <PageHead
        title={t('nav.examBank')}
        sub={t('exams.sub')}
        actions={can('exam.manage') && (
          <>
            {can('ai.use') && <button className="btn btn-gradient" onClick={() => nav('/exams/ai')}><Wand2 size={18} /> {t('exams.createWithAI')}</button>}
            <button className="btn btn-primary" onClick={() => { setInfo(emptyExamInfo()); setParams({ new: '1' }); }}><Plus size={18} /> {t('exams.create')}</button>
          </>
        )}
      />
      <div className="chips">
        <button className="chip" onClick={() => nav('/questions')}><FileStack size={15} /> {t('nav.questionBank')}</button>
        <button className="chip" onClick={() => nav('/assignments')}><Send size={15} /> {t('nav.assigned')}</button>
      </div>
      <form className="input-icon" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <Search size={18} />
        <input className="input" placeholder={t('exams.search')} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q)} />
      </form>
      <div className="chips">
        {STATUSES.map((s) => (
          <button key={s} className={`chip ${status === s ? 'active' : ''}`} onClick={() => setParams(s ? { status: s } : {})}>{s ? t(`exam.status.${s}`) : t('common.all')}</button>
        ))}
      </div>

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={ClipboardList} title={t('exams.empty')} desc={t('exams.emptyDesc')} />
      ) : (
        <div className="grid-cards">
          {data.map((e) => (
            <div key={e.id} className="card stack-sm clickable" onClick={() => nav(`/exams/${e.id}`)}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="bold">{e.title}</div>
                  <div className="small muted">{[e.subject, e.grade_level && `${t('common.grade')} ${e.grade_level}`].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="dropdown" onClick={(ev) => ev.stopPropagation()}>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMenu(menu === e.id ? null : e.id)}><MoreVertical size={18} /></button>
                  {menu === e.id && (
                    <div className="menu" onMouseLeave={() => setMenu(null)}>
                      {e.status === 'published' && can('assignment.manage') && <button onClick={() => { setMenu(null); setAssigning(e); }}><Send size={16} /> {t('assignments.assign')}</button>}
                      {can('exam.manage') && <button onClick={() => { setMenu(null); duplicate(e); }}><Copy size={16} /> {t('exams.duplicate')}</button>}
                      {can('content.share') && <button onClick={() => { setMenu(null); setCopying(e); }}><FileStack size={16} /> {t('share.copyTo')}</button>}
                      {can('exam.manage') && <button onClick={() => { setMenu(null); remove(e); }} style={{ color: 'var(--red)' }}><Trash2 size={16} /> {t('common.delete')}</button>}
                    </div>
                  )}
                </div>
              </div>
              <div className="row-wrap">
                <ExamStatusBadge status={e.status} />
                <Badge tone="primary">{t(`exams.kind.${e.kind}`)}</Badge>
                <Badge>{t('exams.nQuestions', { n: e.question_count })}</Badge>
                <Badge tone="orange">{t('questions.nPoints', { n: e.total_points })}</Badge>
                {e.assignment_count > 0 && <Badge tone="green">{t('exams.assignedN', { n: e.assignment_count })}</Badge>}
              </div>
              <div className="xs muted">{e.created_by_name}</div>
              {e.status === 'published' && can('assignment.manage') && (
                <button className="btn btn-soft btn-sm" onClick={(ev) => { ev.stopPropagation(); setAssigning(e); }}><Send size={15} /> {t('assignments.assign')}</button>
              )}
            </div>
          ))}
        </div>
      )}
      {can('exam.manage') && <button className="fab" onClick={() => { setInfo(emptyExamInfo()); setParams({ new: '1' }); }}><Plus size={26} /></button>}

      <Modal open={creating} onClose={() => setParams({})} title={t('exams.create')}>
        <ExamInfoForm value={info} onChange={setInfo} />
        <div className="modal-foot">
          <button className="btn" onClick={() => setParams({})}>{t('common.cancel')}</button>
          <AsyncButton className="btn btn-primary" onClick={create} disabled={!info.title.trim()}>{t('common.continue')}</AsyncButton>
        </div>
      </Modal>
      <AssignModal open={!!assigning} examId={assigning?.id} onClose={() => setAssigning(null)} onDone={() => { setAssigning(null); reload(); nav('/assignments'); }} />
      <CopyToModal
        open={!!copying}
        onClose={() => setCopying(null)}
        onCopy={async (wsId) => {
          try {
            await api.post(`/exams/${copying.id}/copy-to`, { workspaceId: wsId });
            toast.success(t('share.copied'));
            setCopying(null);
          } catch (err) {
            toast.error(errText(err));
          }
        }}
      />
    </div>
  );
}
