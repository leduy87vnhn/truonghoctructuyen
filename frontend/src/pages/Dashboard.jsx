import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlarmClock, Building2, CalendarCheck, ChevronRight, ClipboardCheck, ClipboardList, FilePlus2, GraduationCap,
  PenLine, Send, UserCheck, Users, Wand2,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { ClassChip, Empty, ErrorBox, fmtDateTime, Spinner, StatCard, useApi } from '../ui.jsx';
import { wsLabel } from '../layout/AppLayout.jsx';

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const { user, workspace, can } = useAuth();
  const { data, loading, error, reload } = useApi('/dashboard');
  const nav = useNavigate();
  const today = new Date().toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const firstName = user.full_name.trim().split(/\s+/).pop();

  const quick = [
    can('exam.manage') && { icon: FilePlus2, label: t('dashboard.createExam'), to: '/exams?new=1', tone: 'primary' },
    can('exam.manage') && can('ai.use') && { icon: Wand2, label: t('dashboard.aiExam'), to: '/exams/ai', tone: 'pink' },
    can('grade.update') && { icon: PenLine, label: t('dashboard.grade'), to: '/grading', tone: 'orange' },
    can('attendance.manage') && { icon: UserCheck, label: t('dashboard.attendance'), to: '/classes?pick=attendance', tone: 'green' },
  ].filter(Boolean);

  return (
    <div className="stack">
      <div className="hero">
        <div className="small" style={{ opacity: 0.85 }}>{today}</div>
        <h1 style={{ fontSize: '1.45rem', marginTop: 4 }}>{t('dashboard.hello', { name: firstName })} 👋</h1>
        <div className="small mt-1" style={{ opacity: 0.9 }}>{wsLabel(workspace, t)}</div>
      </div>

      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <>
          <div className="grid-2 grid-4">
            <StatCard icon={GraduationCap} value={data.stats.class_count} label={t('dashboard.classes')} tone="primary" onClick={() => nav('/classes')} />
            <StatCard icon={Users} value={data.stats.student_count} label={t('dashboard.students')} tone="sky" onClick={() => nav('/students')} />
            <StatCard icon={ClipboardCheck} value={data.stats.pending_grading} label={t('dashboard.pendingGrading')} tone="orange" onClick={() => nav('/grading')} />
            <StatCard icon={Send} value={data.stats.active_assignments} label={t('dashboard.activeAssignments')} tone="green" onClick={() => nav('/assignments')} />
          </div>

          {quick.length > 0 && (
            <div className="card">
              <h3 className="mb-3">{t('dashboard.quickActions')}</h3>
              <div className="grid-2 grid-4">
                {quick.map((q) => (
                  <button key={q.to} className="btn btn-block" style={{ minHeight: 64, flexDirection: 'column', gap: 6, whiteSpace: 'normal' }} onClick={() => nav(q.to)}>
                    <span className={`stat-ic tone-${q.tone}`} style={{ width: 32, height: 32 }}><q.icon size={18} /></span>
                    <span className="small">{q.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.org && (
            <div className="card">
              <div className="card-head">
                <h3 className="row"><Building2 size={18} /> {t('dashboard.orgOverview')}</h3>
                <button className="btn btn-ghost btn-sm" onClick={() => nav('/org')}>{t('common.viewAll')} <ChevronRight size={16} /></button>
              </div>
              <div className="grid-2 grid-4">
                <div><div className="stat-val">{data.org.teacher_count}</div><div className="stat-label">{t('org.teachers')}</div></div>
                <div><div className="stat-val">{data.org.class_count}</div><div className="stat-label">{t('org.classes')}</div></div>
                <div><div className="stat-val">{data.org.student_count}</div><div className="stat-label">{t('org.students')}</div></div>
                <div><div className="stat-val">{data.org.completion_rate ?? '—'}{data.org.completion_rate != null && '%'}</div><div className="stat-label">{t('org.completion')}</div></div>
              </div>
              {data.org.exams_pending_review > 0 && (
                <div className="ai-box mt-3 small row clickable" onClick={() => nav('/exams?status=pending_review')}>
                  <ClipboardList size={18} /> {t('dashboard.examsPendingReview', { n: data.org.exams_pending_review })}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h3 className="mb-2">{t('dashboard.todo')}</h3>
            {data.to_grade.length === 0 && data.due_soon.length === 0 ? (
              <p className="muted small">{t('dashboard.allDone')} 🎉</p>
            ) : (
              <div className="list">
                {data.to_grade.map((a) => (
                  <div key={'g' + a.id} className="list-item clickable" onClick={() => nav(`/grading?assignment=${a.id}`)}>
                    <div className="stat-ic tone-orange"><PenLine size={18} /></div>
                    <div className="grow">
                      <div className="bold truncate">{t('dashboard.gradeX', { title: a.title })}</div>
                      <div className="small muted">{a.class_name} · {t('dashboard.nUngraded', { n: a.pending })}</div>
                    </div>
                    <ChevronRight size={18} className="muted" />
                  </div>
                ))}
                {data.due_soon.map((a) => (
                  <div key={'d' + a.id} className="list-item clickable" onClick={() => nav(`/assignments/${a.id}`)}>
                    <div className="stat-ic tone-pink"><AlarmClock size={18} /></div>
                    <div className="grow">
                      <div className="bold truncate">{t('dashboard.dueSoon', { title: a.title })}</div>
                      <div className="small muted">{a.class_name} · {fmtDateTime(a.due_at, i18n.language)} · {t('dashboard.nNotSubmitted', { n: Math.max(0, a.not_submitted) })}</div>
                    </div>
                    <ChevronRight size={18} className="muted" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="card-head">
              <h3>{t('dashboard.myClasses')}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => nav('/classes')}>{t('common.viewAll')} <ChevronRight size={16} /></button>
            </div>
            {data.classes.length === 0 ? (
              <div className="card">
                <Empty icon={CalendarCheck} title={t('classes.empty')} desc={t('classes.emptyDesc')}
                  action={can('class.create') && <button className="btn btn-primary" onClick={() => nav('/classes?new=1')}>{t('classes.create')}</button>} />
              </div>
            ) : (
              <div className="grid-cards">
                {data.classes.map((c) => (
                  <div key={c.id} className="card clickable row" onClick={() => nav(`/classes/${c.id}`)}>
                    <ClassChip name={c.name} color={c.color} />
                    <div className="grow">
                      <div className="bold truncate">{c.name}</div>
                      <div className="small muted">{c.subject || '—'} · {t('classes.nStudents', { n: c.student_count })}</div>
                    </div>
                    <ChevronRight size={18} className="muted" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
