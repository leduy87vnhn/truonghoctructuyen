import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, ChevronRight, ClipboardList, KeyRound, Timer } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { AsyncButton, Badge, Empty, ErrorBox, Field, fmtDateTime, fmtScore, Modal, Spinner, SubmissionBadge, Tabs, useApi, useErrorText, useToast } from '../../ui.jsx';

export function JoinClassModal({ open, onClose, onJoined }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ code: '', studentCode: '' });
  const toast = useToast();
  const errText = useErrorText();
  const join = async () => {
    try {
      const r = await api.post('/student/join', { code: f.code.trim().toUpperCase(), studentCode: f.studentCode.trim() || null });
      toast.success(t('student.joined', { name: r.class_name }));
      setF({ code: '', studentCode: '' });
      onJoined();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('student.joinClass')}>
      <div className="stack">
        <Field label={t('student.classCode')}>
          <input className="input code-big" style={{ textAlign: 'center' }} maxLength={8} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="ABC123" />
        </Field>
        <Field label={t('student.studentCode')} hint={t('student.studentCodeHint')}>
          <input className="input" value={f.studentCode} onChange={(e) => setF({ ...f, studentCode: e.target.value })} />
        </Field>
        <AsyncButton className="btn btn-gradient btn-lg" onClick={join} disabled={f.code.trim().length < 4}>{t('student.join')}</AsyncButton>
      </div>
    </Modal>
  );
}

export default function StudentHome() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/student/assignments');
  const [tab, setTab] = useState('todo');
  const [joinOpen, setJoinOpen] = useState(false);
  const nav = useNavigate();
  const todo = (data || []).filter((a) => (!a.status || a.status === 'in_progress') && a.mode === 'online' && a.assignment_status === 'active');
  const done = (data || []).filter((a) => !todo.includes(a));
  const list = tab === 'todo' ? todo : done;

  return (
    <div className="stack">
      <div className="hero">
        <h1 style={{ fontSize: '1.4rem' }}>{t('dashboard.hello', { name: user.full_name.split(' ').pop() })} 👋</h1>
        <p className="small mt-1" style={{ opacity: 0.9 }}>{todo.length ? t('student.todoCount', { n: todo.length }) : t('student.allDone')}</p>
        <button className="btn btn-white btn-sm mt-3" onClick={() => setJoinOpen(true)}><KeyRound size={16} /> {t('student.joinClass')}</button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'todo', label: t('student.todo'), badge: todo.length }, { key: 'done', label: t('student.done') }]} />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : list.length === 0 ? (
        <Empty icon={ClipboardList} title={tab === 'todo' ? t('student.noTodo') : t('student.noDone')} desc={!data.length ? t('student.joinHint') : ''}
          action={!data.length && <button className="btn btn-primary" onClick={() => setJoinOpen(true)}>{t('student.joinClass')}</button>} />
      ) : (
        <div className="stack-sm">
          {list.map((a) => {
            const overdue = a.due_at && new Date(a.due_at) < new Date() && (!a.status || a.status === 'in_progress');
            return (
              <div key={a.id} className="card clickable row" onClick={() => nav(`/s/assignments/${a.id}`)}>
                <div className="stat-ic" style={{ background: a.class_color || 'var(--primary)', color: '#fff' }}>{a.mode === 'paper' ? <Camera size={18} /> : <ClipboardList size={18} />}</div>
                <div className="grow">
                  <div className="bold truncate">{a.title}</div>
                  <div className="small muted">{a.class_name} · {t('exams.nQuestions', { n: a.question_count })}{a.duration_minutes ? <> · <Timer size={12} /> {a.duration_minutes}′</> : null}</div>
                  <div className="row-wrap mt-1">
                    {a.mode === 'paper' ? <Badge tone="yellow">{t('assignments.paper')}</Badge> : <SubmissionBadge status={a.status} />}
                    {a.due_at && <span className="xs" style={{ color: overdue ? 'var(--red)' : 'var(--muted)' }}>{t('assignments.due')}: {fmtDateTime(a.due_at, i18n.language)}</span>}
                  </div>
                </div>
                {a.final_score != null ? <b style={{ color: 'var(--primary)' }}>{fmtScore(a.final_score)}/{fmtScore(a.max_score)}</b> : <ChevronRight size={18} className="muted" />}
              </div>
            );
          })}
        </div>
      )}
      <JoinClassModal open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={() => { setJoinOpen(false); reload(); }} />
    </div>
  );
}
