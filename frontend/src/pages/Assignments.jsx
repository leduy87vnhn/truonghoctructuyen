import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, ChevronRight, ClipboardList, FileStack, Plus, Send } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Badge, Empty, ErrorBox, fmtDateTime, PageHead, Progress, Spinner, useApi } from '../ui.jsx';
import AssignModal from './AssignModal.jsx';

export function AssignmentRow({ a, hideClass }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const overdue = a.due_at && new Date(a.due_at) < new Date();
  const pct = a.student_count ? Math.round((a.submitted_count / a.student_count) * 100) : 0;
  return (
    <div className="list-item clickable" onClick={() => nav(`/assignments/${a.id}`)} style={{ alignItems: 'flex-start' }}>
      <div className={`stat-ic tone-${a.mode === 'paper' ? 'yellow' : 'primary'}`}>{a.mode === 'paper' ? <Camera size={18} /> : <Send size={18} />}</div>
      <div className="grow stack-sm" style={{ gap: 4 }}>
        <div className="bold truncate">{a.title}</div>
        <div className="small muted">
          {!hideClass && <><span style={{ color: a.class_color || 'var(--primary)', fontWeight: 700 }}>{a.class_name}</span> · </>}
          {a.due_at ? `${t('assignments.due')}: ${fmtDateTime(a.due_at, i18n.language)}` : t('assignments.noDue')}
        </div>
        <div className="row-wrap">
          {a.status === 'closed' && <Badge>{t('assignments.closed')}</Badge>}
          {a.status === 'active' && overdue && <Badge tone="red">{t('assignments.overdue')}</Badge>}
          {a.pending_count > 0 && <Badge tone="orange">{t('classes.nToGrade', { n: a.pending_count })}</Badge>}
          <span className="xs muted">{t('assignments.submittedN', { n: a.submitted_count, total: a.student_count })} · {t('stats.gradedN', { n: a.graded_count })}</span>
        </div>
        {a.mode === 'online' && <Progress value={pct} />}
      </div>
      <ChevronRight size={18} className="muted" />
    </div>
  );
}

export default function Assignments() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [status, setStatus] = useState('active');
  const { data, loading, error, reload } = useApi(`/assignments?status=${status}`, [status]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHead
        title={t('nav.assigned')}
        sub={t('assignments.sub')}
        actions={can('assignment.manage') && <button className="btn btn-primary desktop-only" onClick={() => setOpen(true)}><Plus size={18} /> {t('assignments.assign')}</button>}
      />
      <div className="chips">
        <button className="chip" onClick={() => nav('/exams')}><ClipboardList size={15} /> {t('nav.examBank')}</button>
        <button className="chip" onClick={() => nav('/questions')}><FileStack size={15} /> {t('nav.questionBank')}</button>
      </div>
      <div className="tabs" style={{ alignSelf: 'flex-start' }}>
        {['active', 'closed'].map((s) => (
          <button key={s} className={`tab ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{t(`assignments.status.${s}`)}</button>
        ))}
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={Send} title={t('assignments.empty')} desc={t('assignments.emptyDesc')}
          action={can('assignment.manage') && <button className="btn btn-primary" onClick={() => setOpen(true)}>{t('assignments.assign')}</button>} />
      ) : (
        <div className="card list" style={{ padding: '4px 12px' }}>
          {data.map((a) => <AssignmentRow key={a.id} a={a} />)}
        </div>
      )}
      {can('assignment.manage') && <button className="fab" onClick={() => setOpen(true)}><Plus size={26} /></button>}
      <AssignModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />
    </div>
  );
}
