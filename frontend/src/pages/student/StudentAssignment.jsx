import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Check, CheckCircle2, Clock, Play, X } from 'lucide-react';
import { api } from '../../api.js';
import { AsyncButton, Badge, ErrorBox, fmtDateTime, fmtScore, Lightbox, PageHead, Spinner, useApi, useConfirm, useErrorText, useToast } from '../../ui.jsx';

function Timer({ startedAt, minutes, onExpire }) {
  const end = new Date(startedAt).getTime() + minutes * 60000;
  const [left, setLeft] = useState(end - Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      const l = end - Date.now();
      setLeft(l);
      if (l <= 0 && !fired.current) {
        fired.current = true;
        onExpire();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [end, onExpire]);
  const s = Math.max(0, Math.floor(left / 1000));
  return (
    <span className="timer" style={{ color: s < 60 ? 'var(--red)' : 'var(--text)' }}>
      <Clock size={15} /> {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}

function AnswerInput({ q, value, onChange, result, disabled }) {
  const { t } = useTranslation();
  const correct = q.correct_answer;
  const show = correct !== undefined;
  if (q.type === 'single_choice' || q.type === 'multiple_choice') {
    const multi = q.type === 'multiple_choice';
    const sel = multi ? value || [] : value;
    return (
      <div className="stack-sm">
        {multi && !disabled && <span className="xs muted">{t('student.chooseMany')}</span>}
        {q.options.map((o) => {
          const on = multi ? sel.includes(o.id) : sel === o.id;
          const isC = show && (Array.isArray(correct) ? correct.includes(o.id) : correct === o.id);
          const cls = show ? (isC ? 'correct' : on ? 'wrong' : '') : on ? 'selected' : '';
          return (
            <button key={o.id} disabled={disabled} className={`option-btn ${cls} ${on && show ? 'selected' : ''}`}
              onClick={() => onChange(multi ? (on ? sel.filter((x) => x !== o.id) : [...sel, o.id].sort()) : o.id)}>
              <span className="opt-id">{o.id}</span><span className="grow">{o.text}</span>
              {show && isC && <Check size={18} color="var(--green)" />}
            </button>
          );
        })}
      </div>
    );
  }
  if (q.type === 'true_false') {
    return (
      <div className="grid-2">
        {[true, false].map((v) => {
          const on = value === v;
          const cls = show ? (correct === v ? 'correct' : on ? 'wrong' : '') : on ? 'selected' : '';
          return (
            <button key={String(v)} disabled={disabled} className={`option-btn ${cls}`} style={{ justifyContent: 'center' }} onClick={() => onChange(v)}>
              <b>{v ? t('questions.true') : t('questions.false')}</b>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="stack-sm">
      <textarea className="textarea" disabled={disabled} style={{ minHeight: q.type === 'essay' ? 140 : 56 }} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={q.type === 'essay' ? t('student.essayPh') : t('student.shortPh')} />
      {show && q.type === 'short_answer' && <div className="small" style={{ color: 'var(--green)' }}>✓ {(correct || []).join(' | ')}</div>}
      {result?.feedback && <div className="ai-box small">💬 {result.feedback}</div>}
    </div>
  );
}

export default function StudentAssignment() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { data, loading, error, reload } = useApi(`/student/assignments/${id}`);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState('');
  const [img, setImg] = useState(null);
  const fileRef = useRef(null);
  const dirty = useRef(false);
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();

  useEffect(() => {
    if (data?.submission) setAnswers(data.submission.answers || {});
  }, [data]);

  const editing = data?.submission?.status === 'in_progress';

  // Tự động lưu nháp mỗi 10 giây nếu có thay đổi
  useEffect(() => {
    if (!editing) return;
    const timer = setInterval(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      setSaving('…');
      try {
        await api.put(`/student/assignments/${id}/answers`, { answers: answersRef.current });
        setSaving(t('student.autosaved'));
      } catch {
        setSaving('');
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [editing, id, t]);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const submit = useCallback(async (force) => {
    try {
      const r = await api.post(`/student/assignments/${id}/submit`, { answers: answersRef.current });
      toast.success(r.status === 'graded' ? t('student.submittedScore', { score: fmtScore(r.final_score), max: fmtScore(r.max_score) }) : t('student.submitted'));
      reload();
    } catch (e) {
      if (!force) toast.error(errText(e));
      else reload();
    }
  }, [id, reload, t, toast, errText]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { assignment: a, questions, submission: sub, results, show_result } = data;

  const start = async () => {
    try {
      await api.post(`/student/assignments/${id}/start`);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const setAns = (qid, v) => {
    dirty.current = true;
    setAnswers((x) => ({ ...x, [qid]: v }));
  };
  const askSubmit = async () => {
    const unanswered = questions.filter((q) => {
      const v = answers[q.id];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    }).length;
    const ok = await confirm({
      title: t('student.submitTitle'),
      message: unanswered ? t('student.unansweredWarn', { n: unanswered }) : t('student.submitConfirm'),
      confirmText: t('student.submit'),
    });
    if (ok) await submit(false);
  };
  const upload = async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('images', f);
    try {
      await api.upload(`/student/assignments/${id}/attachments`, fd);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const answeredCount = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== '' && !(Array.isArray(answers[q.id]) && !answers[q.id].length)).length;
  const totalPoints = questions.reduce((s, q) => s + Number(q.points), 0);

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead back="/s" title={a.title} sub={`${a.class_name}${a.due_at ? ` · ${t('assignments.due')}: ${fmtDateTime(a.due_at, i18n.language)}` : ''}`} />

      {a.mode === 'paper' ? (
        <div className="card center stack" style={{ alignItems: 'center' }}>
          <div className="empty-ic tone-yellow"><Camera size={28} /></div>
          <p>{t('student.paperNote')}</p>
          {sub?.final_score != null && <div className="stat-val">{fmtScore(sub.final_score)}/{fmtScore(sub.max_score)}</div>}
        </div>
      ) : !sub ? (
        <div className="card stack center" style={{ alignItems: 'center' }}>
          {a.instructions && <p className="pre-wrap">{a.instructions}</p>}
          {a.exam_description && <p className="muted small pre-wrap">{a.exam_description}</p>}
          <div className="row-wrap" style={{ justifyContent: 'center' }}>
            <Badge tone="primary">{t('exams.nQuestions', { n: questions.length })}</Badge>
            <Badge tone="orange">{t('questions.nPoints', { n: totalPoints })}</Badge>
            {a.duration_minutes && <Badge tone="pink"><Clock size={12} /> {t('student.minutes', { n: a.duration_minutes })}</Badge>}
          </div>
          <button className="btn btn-gradient btn-lg" onClick={start}><Play size={18} /> {t('student.start')}</button>
        </div>
      ) : (
        <>
          {!editing && (
            <div className="card row">
              <CheckCircle2 color="var(--green)" />
              <div className="grow">
                <div className="bold">{sub.status === 'graded' ? t('student.gradedTitle') : t('student.submittedTitle')}</div>
                <div className="small muted">{fmtDateTime(sub.submitted_at, i18n.language)}{sub.is_late ? ` · ${t('assignments.late')}` : ''}</div>
              </div>
              {sub.final_score != null && <div className="stat-val" style={{ color: 'var(--primary)' }}>{fmtScore(sub.final_score)}<span className="small muted">/{fmtScore(sub.max_score)}</span></div>}
            </div>
          )}
          {!editing && sub.teacher_comment && <div className="ai-box small">💬 {sub.teacher_comment}</div>}
          {!editing && !show_result && <p className="small muted">{t('student.waitResult')}</p>}

          {questions.map((q, i) => {
            const r = results?.[q.id];
            return (
              <div key={q.id} className="card stack-sm">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="q-num">{i + 1}</div>
                  <div className="grow pre-wrap">{q.content}</div>
                  <div className="nowrap small">
                    {r ? <b style={{ color: Number(r.score) >= Number(r.max_score) ? 'var(--green)' : 'var(--orange)' }}>{fmtScore(r.score)}/{fmtScore(q.points)}</b> : <span className="muted">{fmtScore(q.points)}đ</span>}
                  </div>
                </div>
                <AnswerInput q={q} value={answers[q.id]} onChange={(v) => setAns(q.id, v)} result={r} disabled={!editing} />
                {show_result && q.explanation && <div className="xs muted pre-wrap">💡 {q.explanation}</div>}
              </div>
            );
          })}

          {(editing || sub.attachments?.length > 0) && (
            <div className="card stack-sm">
              <div className="row between">
                <h3 className="row"><Camera size={18} /> {t('student.photos')}</h3>
                {editing && <button className="btn btn-soft btn-sm" onClick={() => fileRef.current.click()}><Camera size={15} /> {t('student.addPhoto')}</button>}
              </div>
              {editing && <p className="xs muted">{t('student.photosHint')}</p>}
              <div className="thumbs">
                {(sub.attachments || []).map((f) => (
                  <div key={f.file_id} className="thumb">
                    <img src={f.url} alt="" onClick={() => setImg(f.url)} />
                    {editing && <button className="x" onClick={async () => { await api.del(`/student/assignments/${id}/attachments/${f.file_id}`); reload(); }}><X size={13} /></button>}
                  </div>
                ))}
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { if (e.target.files.length) upload([...e.target.files]); e.target.value = ''; }} />
            </div>
          )}

          {editing && (
            <div className="sticky-bottom row between">
              <div className="small">
                <div><b>{answeredCount}</b>/{questions.length} {t('student.answered')}</div>
                <div className="xs muted row" style={{ gap: 6 }}>
                  {a.duration_minutes && <Timer startedAt={sub.started_at} minutes={a.duration_minutes} onExpire={() => submit(true)} />}
                  {saving}
                </div>
              </div>
              <AsyncButton className="btn btn-gradient" onClick={askSubmit}>{t('student.submit')}</AsyncButton>
            </div>
          )}
        </>
      )}
      <Lightbox src={img} onClose={() => setImg(null)} />
    </div>
  );
}
