import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, RotateCcw, Save, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { api } from '../api.js';
import { AsyncButton, Badge, ErrorBox, Field, Modal, PageHead, Spinner, useApi, useErrorText, useToast } from '../ui.jsx';
import { fromApi, QTYPES, QuestionEditor, QuestionView, toPayload, validateQuestion } from './QuestionEditor.jsx';
import { ExamInfoForm, emptyExamInfo, examInfoPayload } from './Exams.jsx';

// Mẫu cơ cấu đề có sẵn (tổng 10 điểm)
const PRESETS = {
  mixed: [
    { type: 'single_choice', count: 8, points: 0.5 },
    { type: 'true_false', count: 4, points: 0.25 },
    { type: 'short_answer', count: 2, points: 0.5 },
    { type: 'essay', count: 2, points: 2 },
  ],
  quiz15: [{ type: 'single_choice', count: 10, points: 1 }],
  mcq: [
    { type: 'single_choice', count: 16, points: 0.5 },
    { type: 'multiple_choice', count: 4, points: 0.5 },
  ],
  essay: [{ type: 'essay', count: 4, points: 2.5 }],
};

export default function AIExamGenerator() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const errText = useErrorText();
  const status = useApi('/ai/status');
  const [info, setInfo] = useState({ ...emptyExamInfo(), kind: 'test', durationMinutes: 45 });
  const [topic, setTopic] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [difficulty, setDifficulty] = useState('mixed');
  const [notes, setNotes] = useState('');
  const [sections, setSections] = useState(PRESETS.mixed);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [editing, setEditing] = useState(null); // { index, form }

  const qCount = sections.reduce((s, x) => s + (Number(x.count) || 0), 0);
  const total = sections.reduce((s, x) => s + (Number(x.count) || 0) * (Number(x.points) || 0), 0);
  const draftTotal = drafts?.reduce((s, q) => s + Number(q.points || 0), 0) || 0;
  const setSec = (i, patch) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post('/ai/generate-exam', {
        title: info.title || null,
        subject: info.subject || null,
        gradeLevel: info.gradeLevel || null,
        topic,
        difficulty,
        notes: notes || null,
        sourceText: sourceText || null,
        sections: sections.map((s) => ({ type: s.type, count: Number(s.count), points: Number(s.points) })),
      });
      setDrafts(r.questions);
      if (r.questions.length < r.requested) toast.info(t('aiExam.fewer', { got: r.questions.length, want: r.requested }));
      window.scrollTo(0, 0);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const forms = drafts.map(fromApi);
    const bad = forms.map(validateQuestion).findIndex(Boolean);
    if (bad >= 0) return toast.error(`${t('aiExam.question')} ${bad + 1}: ${t(`questions.invalid.${validateQuestion(forms[bad])}`)}`);
    try {
      const exam = await api.post('/exams/from-questions', {
        exam: { ...examInfoPayload({ ...info, title: info.title || topic.slice(0, 150) }) },
        questions: forms.map(toPayload),
      });
      toast.success(t('aiExam.saved'));
      nav(`/exams/${exam.id}?step=content`);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const applyEdit = () => {
    const bad = validateQuestion(editing.form);
    if (bad) return toast.error(t(`questions.invalid.${bad}`));
    const p = toPayload(editing.form);
    const q = { ...p, correct_answer: p.correctAnswer, grade_level: p.gradeLevel };
    setDrafts(drafts.map((d, i) => (i === editing.index ? { ...d, ...q } : d)));
    setEditing(null);
  };

  if (status.loading) return <Spinner />;

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHead back="/exams" title={<span className="row"><Wand2 color="var(--pink)" /> {t('aiExam.title')}</span>} sub={t('aiExam.sub')} />
      {status.data && !status.data.enabled && <div className="form-error">{t('errors.AI_DISABLED')}</div>}
      {status.error && <ErrorBox error={status.error} />}

      {!drafts ? (
        <>
          <div className="card stack">
            <h3>1. {t('aiExam.examInfo')}</h3>
            <ExamInfoForm value={info} onChange={setInfo} />
          </div>

          <div className="card stack">
            <h3>2. {t('aiExam.content')}</h3>
            <Field label={t('aiExam.topic')} hint={t('aiExam.topicHint')}>
              <textarea className="textarea" style={{ minHeight: 70 }} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t('aiExam.topicPh')} />
            </Field>
            <Field label={t('aiExam.source')} hint={t('aiExam.sourceHint')}>
              <textarea className="textarea" value={sourceText} onChange={(e) => setSourceText(e.target.value)} maxLength={15000} placeholder={t('aiExam.sourcePh')} />
            </Field>
            <Field label={t('questions.difficulty')}>
              <div className="chips">
                {['mixed', 'easy', 'medium', 'hard'].map((d) => (
                  <button key={d} className={`chip ${difficulty === d ? 'active' : ''}`} onClick={() => setDifficulty(d)}>{d === 'mixed' ? t('aiExam.mixed') : t(`difficulty.${d}`)}</button>
                ))}
              </div>
            </Field>
          </div>

          <div className="card stack">
            <div className="row between">
              <h3>3. {t('aiExam.matrix')}</h3>
              <Badge tone={total === 10 ? 'green' : 'orange'}>{t('aiExam.summary', { q: qCount, p: Math.round(total * 100) / 100 })}</Badge>
            </div>
            <div className="chips">
              {Object.keys(PRESETS).map((k) => <button key={k} className="chip" onClick={() => setSections(PRESETS[k])}>{t(`aiExam.preset.${k}`)}</button>)}
            </div>
            {sections.map((s, i) => (
              <div key={i} className="card-flat stack-sm" style={{ padding: 12 }}>
                <div className="row">
                  <select className="select input-sm grow" value={s.type} onChange={(e) => setSec(i, { type: e.target.value })}>
                    {QTYPES.map((q) => <option key={q} value={q}>{t(`qtype.${q}`)}</option>)}
                  </select>
                  {sections.length > 1 && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSections(sections.filter((_, j) => j !== i))}><X size={16} /></button>}
                </div>
                <div className="grid-2">
                  <Field label={t('aiExam.count')}><input className="input input-sm" type="number" min="1" max="30" value={s.count} onChange={(e) => setSec(i, { count: e.target.value })} /></Field>
                  <Field label={t('aiExam.pointsEach')}><input className="input input-sm" type="number" min="0.25" step="0.25" value={s.points} onChange={(e) => setSec(i, { points: e.target.value })} /></Field>
                </div>
              </div>
            ))}
            {sections.length < 5 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSections([...sections, { type: 'single_choice', count: 5, points: 1 }])}><Plus size={16} /> {t('aiExam.addSection')}</button>}
            <Field label={t('ai.notes')}><textarea className="textarea" style={{ minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('aiExam.notesPh')} /></Field>
          </div>

          <div className="sticky-bottom">
            <button className="btn btn-gradient btn-lg btn-block" onClick={generate} disabled={busy || topic.trim().length < 2 || qCount < 1 || qCount > 40 || !status.data?.enabled}>
              {busy ? <><Spinner small /> {t('aiExam.generating')}</> : <><Sparkles size={18} /> {t('aiExam.generate', { n: qCount })}</>}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ai-box row-wrap between">
            <span className="small">{t('aiExam.reviewHint')}</span>
            <Badge tone={draftTotal === 10 ? 'green' : 'orange'}>{t('aiExam.summary', { q: drafts.length, p: Math.round(draftTotal * 100) / 100 })}</Badge>
          </div>
          {drafts.map((q, i) => (
            <div key={i} className="card stack-sm">
              <QuestionView q={q} index={i + 1} points={q.points} />
              {q.explanation && <div className="xs muted pre-wrap" style={{ paddingLeft: 40 }}>💡 {q.explanation}</div>}
              <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ index: i, form: fromApi(q) })}><Pencil size={15} /> {t('common.edit')}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}><Trash2 size={15} color="var(--red)" /></button>
              </div>
            </div>
          ))}
          <div className="sticky-bottom row">
            <button className="btn grow" onClick={() => setDrafts(null)}><RotateCcw size={16} /> {t('aiExam.back')}</button>
            <AsyncButton className="btn btn-primary grow" onClick={save} disabled={!drafts.length}><Save size={16} /> {t('aiExam.save')}</AsyncButton>
          </div>
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t('questions.edit')} size="lg">
        {editing && (
          <>
            <QuestionEditor value={editing.form} onChange={(form) => setEditing({ ...editing, form })} />
            <div className="modal-foot">
              <button className="btn" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={applyEdit}>{t('common.apply')}</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
