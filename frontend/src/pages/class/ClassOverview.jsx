import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ClipboardCheck, ClipboardList, Percent, Users } from 'lucide-react';
import { fmtDateTime, StatCard } from '../../ui.jsx';

export default function ClassOverview({ cls }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  return (
    <div className="stack">
      <div className="grid-2 grid-4">
        <StatCard icon={Users} value={cls.student_count} label={t('dashboard.students')} tone="sky" onClick={() => nav(`/classes/${cls.id}/students`)} />
        <StatCard icon={ClipboardList} value={cls.assignment_count} label={t('classes.assignments')} tone="primary" onClick={() => nav(`/classes/${cls.id}/assignments`)} />
        <StatCard icon={ClipboardCheck} value={cls.pending_grading} label={t('dashboard.pendingGrading')} tone="orange" onClick={() => nav(`/grading`)} />
        <StatCard icon={Percent} value={cls.attendance_rate != null ? `${cls.attendance_rate}%` : '—'} label={t('classes.attendanceRate')} tone="green" onClick={() => nav(`/classes/${cls.id}/attendance`)} />
      </div>
      {cls.description && <div className="card pre-wrap">{cls.description}</div>}
      <div className="card">
        <h3 className="mb-2">{t('classes.upcoming')}</h3>
        {cls.upcoming_assignments.length === 0 ? (
          <p className="small muted">{t('classes.noActiveAssignments')}</p>
        ) : (
          <div className="list">
            {cls.upcoming_assignments.map((a) => (
              <div key={a.id} className="list-item clickable" onClick={() => nav(`/assignments/${a.id}`)}>
                <div className="grow">
                  <div className="bold truncate">{a.title}</div>
                  <div className="small muted">
                    {a.due_at ? `${t('assignments.due')}: ${fmtDateTime(a.due_at, i18n.language)}` : t('assignments.noDue')} · {t('assignments.submittedN', { n: a.submitted_count, total: cls.student_count })}
                  </div>
                </div>
                <ChevronRight size={18} className="muted" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
