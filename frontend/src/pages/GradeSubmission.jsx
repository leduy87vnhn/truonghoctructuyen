import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Check, ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Badge, ErrorBox, Field, fmtDateTime, fmtScore, Lightbox, PageHead, Spinner, SubmissionBadge, useApi, useErrorText, useToast } from '../ui.jsx';
import { QuestionView } from './QuestionEditor.jsx';

function AnswerDisplay({ q }) {
  const { t } = useTranslation();
  const a = q.answer;
  if (a === null || a === undefined || a === '' || (Array.isArray(a) && !a.length)) return <span className="muted small">{t('grading.noAnswer')}</span>;
  if (q.type === 'true_false') return <b>{a ? t('questions.true') : t('questions.false')}</b>;
  if (Array.isArray(a)) return <b>{a.join(', ')}</b>;
  return <div className="pre-wrap" style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>{String(a)}</div>;
}

export default function GradeSubmission() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const errText = useErrorText();
  const { data, loading, error, reload } = useApi(`/grading/submissions/${id}`);
  const [scores, setScores] = useState({});
  const [comment, setComment] = useState('');
  const [img, setImg] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef(null);

  // Điểm khởi tạo: giáo viên > tự động > AI gợi ý
  useEffect(() => {
    if (!data) return;
    const s = {};
    for (const q of data.questions) {
      const r = q.results.teacher || q.results.auto || q.results.ai;
      s[q.id] = { score: r ? String(r.score) : '', feedback: r?.feedback || '' };
    }
    setScores(s);
    setComment(data.submission.teacher_comment || '');
  }, [data]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const { submission: sub, student, assignment, questions } = data;
  const canGrade = can('grade.update');
  const total = questions.reduce((s, q) => s + (Number(String(scores[q.id]?.score ?? '').replace(',', '.')) || 0), 0);
  const max = questions.reduce((s, q) => s + Number(q.points), 0);
  const missing = questions.filter((q) => scores[q.id]?.score === '' || scores[q.id]?.score === undefined).length;

  const runAI = async () => {
    setAiBusy(true);
    try {
      await api.post(`/grading/submissions/${id}/ai-grade`);
      toast.success(t('grading.aiDone'));
      reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setAiBusy(false);
    }
  };
  const save = async (goNext) => {
    const items = [];
    for (const q of questions) {
      const v = String(scores[q.id]?.score ?? '').replace(',', '.');
      if (v === '') return toast.error(t('errors.MISSING_SCORES'));
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > Number(q.points)) return toast.error(t('grading.invalidScore', { n: q.position }));
      items.push({ examQuestionId: q.id, score: n, feedback: scores[q.id].feedback || null });
    }
    try {
      const r = await api.put(`/grading/submissions/${id}/grade`, { items, comment: comment || null });
      toast.success(t('grading.saved', { score: fmtScore(r.final_score), max: fmtScore(r.max_score) }));
      if (goNext && data.next_id) nav(`/grading/submissions/${data.next_id}`, { replace: true });
      else reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const uploadMore = async (files) => {
    const fd = new FormData();
    fd.append('studentId', sub.student_id);
    for (const f of files) fd.append('images', f);
    try {
      await api.upload(`/grading/assignments/${assignment.id}/paper`, fd);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const removeImg = async (fileId) => {
    await api.del(`/grading/submissions/${id}/attachments/${fileId}`);
    reload();
  };

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHead
        back={`/grading?assignment=${assignment.id}`}
        title={student.full_name}
        sub={`${assignment.title} · ${assignment.class_name}`}
        actions={
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-icon btn-sm" disabled={!data.prev_id} onClick={() => nav(`/grading/submissions/${data.prev_id}`, { replace: true })}><ChevronLeft size={18} /></button>
            <button className="btn btn-icon btn-sm" disabled={!data.next_id} onClick={() => nav(`/grading/submissions/${data.next_id}`, { replace: true })}><ChevronRight size={18} /></button>
          </div>
        }
      />
      <div className="row-wrap">
        <SubmissionBadge status={sub.status} />
        {sub.is_late && <Badge tone="red">{t('assignments.late')}</Badge>}
        {sub.submitted_at && <span className="xs muted">{t('grading.submittedAt')} {fmtDateTime(sub.submitted_at, i18n.language)}</span>}
      </div>
      {sub.ai_error && <div className="form-error">{t('grading.aiError')}: {t(`errors.${sub.ai_error}`, { defaultValue: sub.ai_error })}</div>}

      {/* Ảnh bài làm */}
      {(sub.attachments.length > 0 || canGrade) && (
        <div className="card stack-sm">
          <div className="row between">
            <h3 className="row"><Camera size={18} /> {t('grading.paperImages')}</h3>
            {canGrade && <button className="btn btn-soft btn-sm" onClick={() => fileRef.current.click()}><Camera size={15} /> {t('grading.addPhoto')}</button>}
          </div>
          {sub.attachments.length === 0 ? <p className="small muted">{t('grading.noImages')}</p> : (
            <div className="thumbs">
              {sub.attachments.map((f) => (
                <div key={f.file_id} className="thumb">
                  <img src={f.url} alt={f.name} onClick={() => setImg(f.url)} />
                  {canGrade && <button className="x" onClick={() => removeImg(f.file_id)}><X size={13} /></button>}
                </div>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { if (e.target.files.length) uploadMore([...e.target.files]); e.target.value = ''; }} />
        </div>
      )}

      {canGrade && can('ai.use') && data.ai_enabled && (
        <div className="ai-box row-wrap between">
          <span className="small">{t('grading.aiHint')}</span>
          <button className="btn btn-gradient btn-sm" onClick={runAI} disabled={aiBusy || sub.status === 'ai_processing'}>
            {aiBusy || sub.status === 'ai_processing' ? <><Spinner small /> {t('grading.aiRunning')}</> : <><Sparkles size={16} /> {t('grading.aiSuggest')}</>}
          </button>
        </div>
      )}

      {questions.map((q) => {
        const ai = q.results.ai;
        const auto = q.results.auto;
        return (
          <div key={q.id} className="card stack-sm">
            <QuestionView q={q} index={q.position} points={q.points} />
            <div style={{ paddingLeft: 40 }} className="stack-sm">
              <div className="label">{t('grading.studentAnswer')}</div>
              <AnswerDisplay q={q} />
              {auto && <div className="small">{Number(auto.score) > 0 ? <Badge tone="green"><Check size={12} /> {t('grading.autoCorrect')}</Badge> : <Badge tone="red"><X size={12} /> {t('grading.autoWrong')}</Badge>}</div>}
              {ai && (
                <div className="ai-box stack-sm">
                  <div className="row between small">
                    <b className="row"><Sparkles size={15} color="var(--primary)" /> {t('grading.aiSuggestion')}: {fmtScore(ai.score)}/{fmtScore(q.points)}</b>
                    {ai.details?.confidence != null && <span className="xs muted">{t('grading.confidence')} {Math.round(ai.details.confidence * 100)}%</span>}
                  </div>
                  {ai.details?.extracted_answer && <div className="xs"><b>{t('grading.aiRead')}:</b> <span className="pre-wrap">{ai.details.extracted_answer}</span></div>}
                  {ai.feedback && <div className="small">{ai.feedback}</div>}
                  {canGrade && <button className="btn btn-soft btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setScores({ ...scores, [q.id]: { score: String(ai.score), feedback: ai.feedback || '' } })}>{t('grading.useAI')}</button>}
                </div>
              )}
              {canGrade && (
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <Field label={`${t('grading.score')} / ${fmtScore(q.points)}`}>
                    <input className="grade-input" style={{ width: 80 }} inputMode="decimal" value={scores[q.id]?.score ?? ''} onChange={(e) => setScores({ ...scores, [q.id]: { ...scores[q.id], score: e.target.value } })} />
                  </Field>
                  <div className="grow">
                    <Field label={t('grading.feedback')}>
                      <input className="input input-sm" value={scores[q.id]?.feedback ?? ''} onChange={(e) => setScores({ ...scores, [q.id]: { ...scores[q.id], feedback: e.target.value } })} />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {canGrade && (
        <div className="card">
          <Field label={t('grading.comment')}><textarea className="textarea" style={{ minHeight: 70 }} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
      )}

      {canGrade && (
        <div className="sticky-bottom row between">
          <div>
            <div className="bold" style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>{fmtScore(total)} / {fmtScore(max)}</div>
            {missing > 0 && <div className="xs" style={{ color: 'var(--orange)' }}>{t('grading.missingN', { n: missing })}</div>}
          </div>
          <div className="row">
            <AsyncButton className="btn" onClick={() => save(false)}>{t('grading.approve')}</AsyncButton>
            {data.next_id && <AsyncButton className="btn btn-primary" onClick={() => save(true)}>{t('grading.approveNext')}</AsyncButton>}
          </div>
        </div>
      )}
      <Lightbox src={img} onClose={() => setImg(null)} />
    </div>
  );
}
