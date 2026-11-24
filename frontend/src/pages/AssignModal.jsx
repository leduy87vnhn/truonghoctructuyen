import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api.js';
import { AsyncButton, Field, fromLocalInput, Modal, Spinner, toLocalInput, useErrorText, useToast } from '../ui.jsx';

/**
 * Giao bài: chọn đề (nếu chưa có) + chọn lớp (nếu chưa có).
 * Mở từ trang lớp => lớp được chọn sẵn; mở từ đề => đề được chọn sẵn.
 */
export default function AssignModal({ open, onClose, onDone, examId, classId }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errText = useErrorText();
  const [exams, setExams] = useState(null);
  const [classes, setClasses] = useState(null);
  const [f, setF] = useState(null);

  useEffect(() => {
    if (!open) return;
    const due = new Date(Date.now() + 7 * 86400000);
    due.setHours(22, 0, 0, 0);
    setF({
      examId: examId || '',
      classIds: classId ? [classId] : [],
      title: '',
      instructions: '',
      mode: 'online',
      dueAt: toLocalInput(due.toISOString()),
      allowLate: true,
      showResult: 'after_grading',
      addToGradebook: true,
      gradeCategory: 'assignment',
      gradeWeight: 1,
    });
    if (!examId) api.get('/exams?status=published').then(setExams).catch(() => setExams([]));
    if (!classId) api.get('/classes').then(setClasses).catch(() => setClasses([]));
  }, [open, examId, classId]);

  const submit = async () => {
    try {
      const r = await api.post('/assignments', {
        ...f,
        title: f.title || null,
        instructions: f.instructions || null,
        dueAt: fromLocalInput(f.dueAt),
        gradeWeight: Number(f.gradeWeight),
      });
      toast.success(t('assignments.assignedN', { n: r.length }));
      onDone?.(r);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const toggleClass = (id) => setF({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id] });

  return (
    <Modal open={open} onClose={onClose} title={t('assignments.assign')}>
      {!f ? <Spinner /> : (
        <div className="stack">
          {!examId && (
            <Field label={t('assignments.exam')}>
              {!exams ? <Spinner small /> : exams.length === 0 ? <p className="small muted">{t('assignments.noPublishedExam')}</p> : (
                <select className="select" value={f.examId} onChange={(e) => setF({ ...f, examId: e.target.value })}>
                  <option value="">— {t('assignments.chooseExam')} —</option>
                  {exams.map((e) => <option key={e.id} value={e.id}>{e.title} ({t('exams.nQuestions', { n: e.question_count })})</option>)}
                </select>
              )}
            </Field>
          )}
          {!classId && (
            <Field label={t('assignments.classes')}>
              {!classes ? <Spinner small /> : classes.length === 0 ? <p className="small muted">{t('classes.empty')}</p> : (
                <div className="row-wrap">
                  {classes.map((c) => (
                    <button key={c.id} className={`chip ${f.classIds.includes(c.id) ? 'active' : ''}`} onClick={() => toggleClass(c.id)}>{c.name}</button>
                  ))}
                </div>
              )}
            </Field>
          )}
          <Field label={t('assignments.titleOptional')}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label={t('assignments.mode')}>
            <div className="seg">
              <button className={f.mode === 'online' ? 'active' : ''} onClick={() => setF({ ...f, mode: 'online' })}>{t('assignments.online')}</button>
              <button className={f.mode === 'paper' ? 'active' : ''} onClick={() => setF({ ...f, mode: 'paper' })}>{t('assignments.paper')}</button>
            </div>
          </Field>
          <Field label={t('assignments.due')}><input className="input" type="datetime-local" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></Field>
          <Field label={t('assignments.instructions')}><textarea className="textarea" style={{ minHeight: 60 }} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
          {f.mode === 'online' && (
            <>
              <label className="check"><input type="checkbox" checked={f.allowLate} onChange={(e) => setF({ ...f, allowLate: e.target.checked })} /> {t('assignments.allowLate')}</label>
              <label className="check"><input type="checkbox" checked={f.showResult === 'immediately'} onChange={(e) => setF({ ...f, showResult: e.target.checked ? 'immediately' : 'after_grading' })} /> {t('assignments.showImmediately')}</label>
            </>
          )}
          <label className="check"><input type="checkbox" checked={f.addToGradebook} onChange={(e) => setF({ ...f, addToGradebook: e.target.checked })} /> {t('assignments.addToGradebook')}</label>
          {f.addToGradebook && (
            <div className="grid-2">
              <Field label={t('gradebook.category')}>
                <select className="select" value={f.gradeCategory} onChange={(e) => setF({ ...f, gradeCategory: e.target.value })}>
                  {['assignment', 'oral', 'quiz', 'test', 'midterm', 'final', 'other'].map((c) => <option key={c} value={c}>{t(`gradebook.cat.${c}`)}</option>)}
                </select>
              </Field>
              <Field label={t('gradebook.weight')}><input className="input" type="number" min="0" max="10" step="0.5" value={f.gradeWeight} onChange={(e) => setF({ ...f, gradeWeight: e.target.value })} /></Field>
            </div>
          )}
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <AsyncButton className="btn btn-primary" onClick={submit} disabled={!f.examId || !f.classIds.length}>{t('assignments.assign')}</AsyncButton>
          </div>
        </div>
      )}
    </Modal>
  );
}
