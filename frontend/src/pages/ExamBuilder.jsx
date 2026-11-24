import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Check, CheckCircle2, Copy, Lock, Plus, Printer, Search, Send, Sparkles, Trash2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Badge, Empty, ErrorBox, ExamStatusBadge, Field, Modal, PageHead, Spinner, useApi, useErrorText, useToast } from '../ui.jsx';
import { emptyQuestion, QuestionEditor, QuestionView, toPayload, validateQuestion } from './QuestionEditor.jsx';
import { AIQuestionsModal } from './Questions.jsx';
import { ExamInfoForm, examInfoPayload } from './Exams.jsx';
import AssignModal from './AssignModal.jsx';

const STEPS = ['info', 'source', 'content', 'config', 'publish'];

function BankPicker({ items, onAdd, onCreated }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, loading, reload } = useApi(`/questions${search ? `?q=${encodeURIComponent(search)}` : ''}`, [search]);
  const [creating, setCreating] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const toast = useToast();
  const errText = useErrorText();
  const inExam = new Set(items.map((i) => i.questionId));

  const createQ = async () => {
    const bad = validateQuestion(creating);
    if (bad) return toast.error(t(`questions.invalid.${bad}`));
    try {
      const r = await api.post('/questions', toPayload(creating));
      onAdd({ ...r, ...r.version, id: r.id, default_points: r.version.default_points });
      setCreating(null);
      reload();
      onCreated?.();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="stack">
      <div className="row-wrap">
        <button className="btn btn-primary" onClick={() => setCreating(emptyQuestion())}><Plus size={18} /> {t('questions.create')}</button>
        {can('ai.use') && <button className="btn btn-soft" onClick={() => setAiOpen(true)}><Sparkles size={18} /> {t('ai.generateQuestions')}</button>}
      </div>
      <form className="input-icon" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <Search size={18} />
        <input className="input" placeholder={t('questions.search')} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q)} />
      </form>
      {loading ? <Spinner /> : !data?.items.length ? <Empty title={t('questions.empty')} /> : (
        <div className="stack-sm">
          {data.items.map((qq) => (
            <div key={qq.id} className="card-flat row" style={{ alignItems: 'flex-start' }}>
              <div className="grow"><QuestionView q={qq} points={qq.default_points} /></div>
              {inExam.has(qq.id) ? (
                <Badge tone="green"><Check size={12} /> {t('exams.added')}</Badge>
              ) : (
                <button className="btn btn-soft btn-sm" onClick={() => onAdd(qq)}><Plus size={16} /> {t('exams.add')}</button>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal open={!!creating} onClose={() => setCreating(null)} title={t('questions.create')} size="lg">
        {creating && (
          <>
            <QuestionEditor value={creating} onChange={setCreating} />
            <div className="modal-foot">
              <button className="btn" onClick={() => setCreating(null)}>{t('common.cancel')}</button>
              <AsyncButton className="btn btn-primary" onClick={createQ}>{t('exams.createAndAdd')}</AsyncButton>
            </div>
          </>
        )}
      </Modal>
      <AIQuestionsModal open={aiOpen} onClose={() => setAiOpen(false)} onSaved={() => { setAiOpen(false); reload(); }} />
    </div>
  );
}

export default function ExamBuilder() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const errText = useErrorText();
  const { data: exam, loading, error, reload } = useApi(`/exams/${id}`);
  const [info, setInfo] = useState(null);
  const [items, setItems] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const step = STEPS.includes(params.get('step')) ? params.get('step') : exam?.questions?.length ? 'content' : 'info';

  useEffect(() => {
    if (!exam) return;
    setInfo({
      title: exam.title,
      kind: exam.kind,
      subject: exam.subject || '',
      gradeLevel: exam.grade_level || '',
      durationMinutes: exam.duration_minutes || '',
      description: exam.description || '',
      shuffleQuestions: exam.shuffle_questions,
    });
    setItems(exam.questions.map((q) => ({ questionId: q.question_id, questionVersionId: q.question_version_id, points: Number(q.points), q })));
    setDirty(false);
  }, [exam]);

  const total = useMemo(() => items.reduce((s, i) => s + (Number(i.points) || 0), 0), [items]);
  if (loading || !info) return error ? <ErrorBox error={error} onRetry={reload} /> : <Spinner />;

  const readOnly = !exam.can_edit || exam.locked;
  const saveAll = async () => {
    if (readOnly) return true;
    try {
      await api.patch(`/exams/${id}`, { ...examInfoPayload(info), shuffleQuestions: !!info.shuffleQuestions });
      if (dirty) {
        await api.put(`/exams/${id}/questions`, { items: items.map((i) => ({ questionId: i.questionId, questionVersionId: i.questionVersionId, points: Number(i.points) || 0 })) });
        setDirty(false);
      }
      return true;
    } catch (e) {
      toast.error(errText(e));
      return false;
    }
  };
  const goStep = async (s) => {
    if (await saveAll()) setParams({ step: s }, { replace: true });
  };
  const addQ = (q) => {
    setItems((x) => [...x, { questionId: q.id, questionVersionId: null, points: Number(q.default_points) || 1, q: { ...q, type: q.type } }]);
    setDirty(true);
    toast.success(t('exams.addedToExam'));
  };
  const move = (i, d) => {
    const x = [...items];
    [x[i], x[i + d]] = [x[i + d], x[i]];
    setItems(x);
    setDirty(true);
  };
  const publish = async () => {
    if (!(await saveAll())) return;
    try {
      const r = await api.post(`/exams/${id}/publish`);
      toast.success(r.status === 'published' ? t('exams.publishedMsg') : t('exams.sentForReview'));
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const review = async (approve) => {
    await api.post(`/exams/${id}/review`, { approve });
    toast.success(approve ? t('exams.approved') : t('exams.rejected'));
    reload();
  };
  const duplicate = async () => {
    const r = await api.post(`/exams/${id}/duplicate`);
    nav(`/exams/${r.id}`);
  };
  const idx = STEPS.indexOf(step);

  return (
    <div className="stack">
      <PageHead
        back="/exams"
        title={info.title || t('exams.untitled')}
        sub={<span className="row-wrap"><ExamStatusBadge status={exam.status} /> {t('exams.nQuestions', { n: items.length })} · {t('questions.nPoints', { n: total })}</span>}
        actions={<button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={16} /> {t('exams.print')}</button>}
      />
      {exam.locked && (
        <div className="ai-box row-wrap between">
          <span className="small row"><Lock size={16} /> {t('exams.lockedNote')}</span>
          <button className="btn btn-soft btn-sm" onClick={duplicate}><Copy size={15} /> {t('exams.duplicate')}</button>
        </div>
      )}

      <div className="steps no-print">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i < idx ? 'done' : ''} ${s === step ? 'active' : ''}`} onClick={() => goStep(s)}>
            <div className="bar" />
            <span>{i + 1}. {t(`exams.step.${s}`)}</span>
          </div>
        ))}
      </div>

      {step === 'info' && (
        <div className="card">
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}><ExamInfoForm value={info} onChange={setInfo} /></fieldset>
        </div>
      )}

      {step === 'source' && (readOnly ? <div className="card muted">{t('exams.readOnly')}</div> : <BankPicker items={items} onAdd={addQ} />)}

      {step === 'content' && (
        items.length === 0 ? (
          <Empty title={t('exams.noQuestions')} action={!readOnly && <button className="btn btn-primary" onClick={() => goStep('source')}>{t('exams.addQuestions')}</button>} />
        ) : (
          <div className="stack-sm">
            {items.map((it, i) => (
              <div key={`${it.questionId}-${i}`} className="card stack-sm">
                <QuestionView q={it.q} index={i + 1} />
                {!readOnly && (
                  <div className="row between no-print" style={{ paddingLeft: 40 }}>
                    <div className="row">
                      <span className="small muted">{t('questions.points')}</span>
                      <input className="grade-input" inputMode="decimal" value={it.points} onChange={(e) => { setItems(items.map((x, j) => (j === i ? { ...x, points: e.target.value } : x))); setDirty(true); }} />
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { setItems(items.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 size={16} color="var(--red)" /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className="card-flat row between"><b>{t('exams.totalPoints')}</b><b style={{ color: 'var(--primary)' }}>{total}</b></div>
          </div>
        )
      )}

      {step === 'config' && (
        <div className="card stack">
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <Field label={t('exams.duration')} hint={t('exams.durationHint')}>
              <input className="input" type="number" min="1" value={info.durationMinutes} onChange={(e) => setInfo({ ...info, durationMinutes: e.target.value })} />
            </Field>
            <label className="check"><input type="checkbox" checked={!!info.shuffleQuestions} onChange={(e) => setInfo({ ...info, shuffleQuestions: e.target.checked })} /> {t('exams.shuffle')}</label>
          </fieldset>
          <p className="xs muted">{t('exams.configNote')}</p>
        </div>
      )}

      {step === 'publish' && (
        <div className="card stack">
          <div className="grid-2">
            <div><div className="stat-val">{items.length}</div><div className="stat-label">{t('exams.questions')}</div></div>
            <div><div className="stat-val">{total}</div><div className="stat-label">{t('exams.totalPoints')}</div></div>
          </div>
          {total !== 10 && items.length > 0 && <div className="small" style={{ color: 'var(--orange)' }}>{t('exams.not10', { n: total })}</div>}
          {exam.status === 'draft' && !readOnly && (
            <AsyncButton className="btn btn-gradient btn-lg" onClick={publish} disabled={!items.length}><CheckCircle2 size={18} /> {t('exams.publish')}</AsyncButton>
          )}
          {exam.status === 'pending_review' && (
            can('exam.approve') ? (
              <div className="row">
                <AsyncButton className="btn btn-danger grow" onClick={() => review(false)}><XCircle size={18} /> {t('exams.reject')}</AsyncButton>
                <AsyncButton className="btn btn-success grow" onClick={() => review(true)}><CheckCircle2 size={18} /> {t('exams.approve')}</AsyncButton>
              </div>
            ) : <div className="ai-box small">{t('exams.waitingReview')}</div>
          )}
          {exam.status === 'published' && (
            <>
              <div className="ai-box small row"><CheckCircle2 size={18} color="var(--green)" /> {t('exams.publishedMsg')}</div>
              {can('assignment.manage') && <button className="btn btn-primary btn-lg" onClick={() => setAssignOpen(true)}><Send size={18} /> {t('assignments.assign')}</button>}
              {exam.can_edit && Number(exam.assignment_count) === 0 && (
                <AsyncButton className="btn btn-ghost" onClick={async () => { await api.post(`/exams/${id}/unpublish`); reload(); }}>{t('exams.unpublish')}</AsyncButton>
              )}
            </>
          )}
        </div>
      )}

      <div className="sticky-bottom row between no-print">
        <button className="btn" disabled={idx === 0} onClick={() => goStep(STEPS[idx - 1])}>{t('common.back')}</button>
        <span className="xs muted">{dirty ? t('attendance.unsaved') : ''}</span>
        {idx < STEPS.length - 1 ? (
          <AsyncButton className="btn btn-primary" onClick={() => goStep(STEPS[idx + 1])}>{t('common.continue')}</AsyncButton>
        ) : (
          <AsyncButton className="btn btn-primary" onClick={async () => (await saveAll()) && toast.success(t('common.saved'))} disabled={readOnly}>{t('common.save')}</AsyncButton>
        )}
      </div>
      <AssignModal open={assignOpen} examId={id} onClose={() => setAssignOpen(false)} onDone={() => { setAssignOpen(false); nav('/assignments'); }} />
    </div>
  );
}
