import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import { Badge, Field } from '../ui.jsx';

export const QTYPES = ['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'essay'];
const LETTERS = 'ABCDEFGHIJ';

export function emptyQuestion(type = 'single_choice', base = {}) {
  return {
    type,
    content: '',
    options: ['single_choice', 'multiple_choice'].includes(type) ? [0, 1, 2, 3].map((i) => ({ id: LETTERS[i], text: '' })) : [],
    correct: type === 'multiple_choice' ? [] : type === 'true_false' ? true : type === 'short_answer' ? '' : type === 'single_choice' ? 'A' : null,
    explanation: '',
    rubric: '',
    points: 1,
    difficulty: 'medium',
    subject: base.subject || '',
    gradeLevel: base.gradeLevel || '',
    topic: base.topic || '',
  };
}

/** Dòng dữ liệu API (questions/AI) -> state của form */
export function fromApi(q) {
  return {
    type: q.type,
    content: q.content || '',
    options: q.options || [],
    correct: q.type === 'short_answer' ? (q.correct_answer || []).join('\n') : q.correct_answer ?? (q.type === 'multiple_choice' ? [] : null),
    explanation: q.explanation || '',
    rubric: q.rubric || '',
    points: Number(q.default_points ?? q.points ?? 1),
    difficulty: q.difficulty || 'medium',
    subject: q.subject || '',
    gradeLevel: q.grade_level ?? q.gradeLevel ?? '',
    topic: q.topic || '',
  };
}

/** State của form -> payload gửi API */
export function toPayload(f) {
  return {
    type: f.type,
    content: f.content,
    options: f.options,
    correctAnswer: f.type === 'short_answer' ? String(f.correct || '').split('\n').map((s) => s.trim()).filter(Boolean) : f.correct,
    explanation: f.explanation || null,
    rubric: f.rubric || null,
    points: Number(f.points) || 1,
    difficulty: f.difficulty,
    subject: f.subject || null,
    gradeLevel: f.gradeLevel || null,
    topic: f.topic || null,
  };
}

export function validateQuestion(f) {
  if (!f.content.trim()) return 'content';
  if (['single_choice', 'multiple_choice'].includes(f.type)) {
    if (f.options.filter((o) => o.text.trim()).length < 2) return 'options';
    if (f.type === 'single_choice' && !f.options.find((o) => o.id === f.correct)) return 'correct';
    if (f.type === 'multiple_choice' && !f.correct?.length) return 'correct';
  }
  if (f.type === 'short_answer' && !String(f.correct || '').trim()) return 'correct';
  return null;
}

export function QuestionEditor({ value: f, onChange, compact }) {
  const { t } = useTranslation();
  const set = (patch) => onChange({ ...f, ...patch });
  const changeType = (type) => {
    const e = emptyQuestion(type);
    set({ type, options: ['single_choice', 'multiple_choice'].includes(type) ? (f.options.length >= 2 ? f.options : e.options) : [], correct: e.correct });
  };
  const setOpt = (i, text) => set({ options: f.options.map((o, j) => (j === i ? { ...o, text } : o)) });
  const addOpt = () => f.options.length < 8 && set({ options: [...f.options, { id: LETTERS[f.options.length], text: '' }] });
  const removeOpt = (i) => {
    const opts = f.options.filter((_, j) => j !== i).map((o, j) => ({ ...o, id: LETTERS[j] }));
    set({ options: opts, correct: f.type === 'multiple_choice' ? [] : 'A' });
  };
  const toggleCorrect = (id) => {
    if (f.type === 'single_choice') set({ correct: id });
    else set({ correct: f.correct.includes(id) ? f.correct.filter((x) => x !== id) : [...f.correct, id].sort() });
  };

  return (
    <div className="stack">
      {!compact && (
        <Field label={t('questions.type')}>
          <div className="chips">
            {QTYPES.map((ty) => (
              <button key={ty} type="button" className={`chip ${f.type === ty ? 'active' : ''}`} onClick={() => changeType(ty)}>{t(`qtype.${ty}`)}</button>
            ))}
          </div>
        </Field>
      )}
      <Field label={t('questions.content')}>
        <textarea className="textarea" value={f.content} onChange={(e) => set({ content: e.target.value })} placeholder={t('questions.contentPh')} />
      </Field>

      {['single_choice', 'multiple_choice'].includes(f.type) && (
        <Field label={t('questions.options')} hint={t('questions.optionsHint')}>
          <div className="stack-sm">
            {f.options.map((o, i) => {
              const on = f.type === 'single_choice' ? f.correct === o.id : f.correct?.includes(o.id);
              return (
                <div key={i} className="row">
                  <button type="button" className={`btn btn-icon btn-sm ${on ? 'btn-success' : ''}`} onClick={() => toggleCorrect(o.id)} title={t('questions.markCorrect')}>
                    {on ? <Check size={16} /> : o.id}
                  </button>
                  <input className="input input-sm grow" value={o.text} onChange={(e) => setOpt(i, e.target.value)} placeholder={`${t('questions.option')} ${o.id}`} />
                  {f.options.length > 2 && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => removeOpt(i)}><X size={16} /></button>}
                </div>
              );
            })}
            {f.options.length < 8 && <button type="button" className="btn btn-ghost btn-sm" onClick={addOpt} style={{ alignSelf: 'flex-start' }}><Plus size={16} /> {t('questions.addOption')}</button>}
          </div>
        </Field>
      )}

      {f.type === 'true_false' && (
        <Field label={t('questions.correctAnswer')}>
          <div className="seg">
            <button type="button" className={f.correct === true ? 'active' : ''} onClick={() => set({ correct: true })}>{t('questions.true')}</button>
            <button type="button" className={f.correct === false ? 'active' : ''} onClick={() => set({ correct: false })}>{t('questions.false')}</button>
          </div>
        </Field>
      )}
      {f.type === 'short_answer' && (
        <Field label={t('questions.acceptedAnswers')} hint={t('questions.acceptedHint')}>
          <textarea className="textarea" style={{ minHeight: 70 }} value={f.correct || ''} onChange={(e) => set({ correct: e.target.value })} />
        </Field>
      )}
      {f.type === 'essay' && (
        <Field label={t('questions.rubric')} hint={t('questions.rubricHint')}>
          <textarea className="textarea" value={f.rubric} onChange={(e) => set({ rubric: e.target.value })} />
        </Field>
      )}

      <div className="grid-2">
        <Field label={t('questions.points')}>
          <input className="input" type="number" min="0.25" step="0.25" value={f.points} onChange={(e) => set({ points: e.target.value })} />
        </Field>
        <Field label={t('questions.difficulty')}>
          <select className="select" value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value })}>
            {['easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{t(`difficulty.${d}`)}</option>)}
          </select>
        </Field>
      </div>
      {!compact && (
        <div className="grid-2">
          <Field label={t('common.subject')}><input className="input" value={f.subject} onChange={(e) => set({ subject: e.target.value })} /></Field>
          <Field label={t('common.gradeLevel')}><input className="input" value={f.gradeLevel} onChange={(e) => set({ gradeLevel: e.target.value })} /></Field>
        </div>
      )}
      {!compact && <Field label={t('questions.topic')}><input className="input" value={f.topic} onChange={(e) => set({ topic: e.target.value })} /></Field>}
      <Field label={t('questions.explanation')}>
        <textarea className="textarea" style={{ minHeight: 60 }} value={f.explanation} onChange={(e) => set({ explanation: e.target.value })} />
      </Field>
    </div>
  );
}

/** Hiển thị câu hỏi (chỉ đọc) kèm đáp án đúng */
export function QuestionView({ q, index, points, showAnswer = true }) {
  const { t } = useTranslation();
  const correct = q.correct_answer ?? q.correct;
  const isCorrect = (id) => (Array.isArray(correct) ? correct.includes(id) : correct === id);
  return (
    <div className="stack-sm">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {index != null && <div className="q-num">{index}</div>}
        <div className="grow">
          <div className="pre-wrap">{q.content}</div>
          <div className="row-wrap mt-1">
            <Badge tone="primary">{t(`qtype.${q.type}`)}</Badge>
            {q.difficulty && <Badge tone={{ easy: 'green', medium: 'yellow', hard: 'red' }[q.difficulty]}>{t(`difficulty.${q.difficulty}`)}</Badge>}
            {points != null && <Badge tone="orange">{t('questions.nPoints', { n: points })}</Badge>}
            {q.topic && <Badge>{q.topic}</Badge>}
          </div>
        </div>
      </div>
      {q.options?.length > 0 && (
        <div className="stack-sm" style={{ paddingLeft: index != null ? 40 : 0 }}>
          {q.options.map((o) => (
            <div key={o.id} className="small row" style={{ alignItems: 'flex-start', color: showAnswer && isCorrect(o.id) ? 'var(--green)' : undefined, fontWeight: showAnswer && isCorrect(o.id) ? 700 : 400 }}>
              <span>{o.id}.</span><span className="grow">{o.text}</span>{showAnswer && isCorrect(o.id) && <Check size={16} />}
            </div>
          ))}
        </div>
      )}
      {showAnswer && q.type === 'true_false' && <div className="small" style={{ paddingLeft: index != null ? 40 : 0, color: 'var(--green)' }}>✓ {correct ? t('questions.true') : t('questions.false')}</div>}
      {showAnswer && q.type === 'short_answer' && <div className="small" style={{ paddingLeft: index != null ? 40 : 0, color: 'var(--green)' }}>✓ {(Array.isArray(correct) ? correct : String(correct || '').split('\n')).join(' | ')}</div>}
      {showAnswer && q.type === 'essay' && q.rubric && <div className="xs muted pre-wrap" style={{ paddingLeft: index != null ? 40 : 0 }}>{t('questions.rubric')}: {q.rubric}</div>}
    </div>
  );
}
