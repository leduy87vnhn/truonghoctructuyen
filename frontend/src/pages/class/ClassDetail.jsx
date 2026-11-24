import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, BookOpenCheck, ClipboardList, Copy, LayoutDashboard, Pencil, RefreshCw, UserCheck, Users } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Badge, ErrorBox, PageHead, Spinner, Tabs, useApi, useToast } from '../../ui.jsx';
import { ClassForm } from '../Classes.jsx';
import ClassOverview from './ClassOverview.jsx';
import ClassStudents from './ClassStudents.jsx';
import ClassAttendance from './ClassAttendance.jsx';
import ClassAssignments from './ClassAssignments.jsx';
import ClassGradebook from './ClassGradebook.jsx';
import ClassStats from './ClassStats.jsx';

const TABS = ['overview', 'students', 'attendance', 'assignments', 'gradebook', 'stats'];
const ICONS = { overview: LayoutDashboard, students: Users, attendance: UserCheck, assignments: ClipboardList, gradebook: BookOpenCheck, stats: BarChart3 };

export default function ClassDetail() {
  const { id, tab = 'overview' } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data: cls, loading, error, reload, setData } = useApi(`/classes/${id}`);
  const [editing, setEditing] = useState(false);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const current = TABS.includes(tab) ? tab : 'overview';
  const props = { cls, reloadClass: reload };
  const copyCode = () => {
    navigator.clipboard?.writeText(cls.join_code);
    toast.success(t('classes.codeCopied'));
  };

  return (
    <div className="stack">
      <PageHead
        back="/classes"
        title={cls.name}
        sub={
          <span>
            {[cls.school_year, t('classes.nStudents', { n: cls.student_count }), cls.teachers.map((x) => x.full_name).join(', ')].filter(Boolean).join(' · ')}
          </span>
        }
        actions={cls.can_manage && <button className="btn btn-soft btn-sm" onClick={() => setEditing(true)}><Pencil size={15} /> {t('common.edit')}</button>}
      />
      <div className="card-flat row between" style={{ padding: '10px 14px' }}>
        <div className="small">
          {t('classes.joinCode')}: <span className="kbd">{cls.join_code}</span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={copyCode} aria-label="copy"><Copy size={16} /></button>
          {cls.can_manage && (
            <button
              className="btn btn-ghost btn-icon btn-sm"
              aria-label="regenerate"
              onClick={async () => {
                const r = await api.post(`/classes/${id}/join-code`);
                setData((c) => ({ ...c, join_code: r.join_code }));
              }}
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>
      </div>
      {cls.archived && <Badge>{t('classes.archived')}</Badge>}

      <Tabs
        value={current}
        onChange={(k) => nav(`/classes/${id}/${k}`, { replace: true })}
        tabs={TABS.filter((k) => k !== 'stats' || can('report.view')).map((k) => ({
          key: k,
          label: t(`classTabs.${k}`),
          icon: ICONS[k],
          badge: k === 'assignments' && cls.pending_grading ? cls.pending_grading : null,
        }))}
      />

      {current === 'overview' && <ClassOverview {...props} />}
      {current === 'students' && <ClassStudents {...props} />}
      {current === 'attendance' && <ClassAttendance {...props} />}
      {current === 'assignments' && <ClassAssignments {...props} />}
      {current === 'gradebook' && <ClassGradebook {...props} />}
      {current === 'stats' && <ClassStats {...props} />}

      <ClassForm open={editing} initial={cls} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
    </div>
  );
}
