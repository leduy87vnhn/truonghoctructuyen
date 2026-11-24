import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChartColumn } from 'lucide-react';
import { ClassChip, Empty, ErrorBox, fmtScore, PageHead, Progress, Spinner, useApi } from '../ui.jsx';

export default function Reports() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/reports/classes');
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHead title={t('nav.reports')} sub={t('reports.sub')} />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={ChartColumn} title={t('classes.empty')} />
      ) : (
        <div className="grid-cards">
          {data.map((c) => (
            <div key={c.id} className="card stack-sm clickable" onClick={() => nav(`/classes/${c.id}/stats`)}>
              <div className="row">
                <ClassChip name={c.name} color={c.color} />
                <div className="grow">
                  <div className="bold truncate">{c.name}</div>
                  <div className="small muted">{t('classes.nStudents', { n: c.student_count })} · {t('reports.nAssignments', { n: c.assignment_count })}</div>
                </div>
                <div className="center">
                  <div className="stat-val" style={{ fontSize: '1.3rem', color: 'var(--primary)' }}>{fmtScore(c.avg_score)}</div>
                  <div className="xs muted">{t('stats.avg')}</div>
                </div>
              </div>
              <div className="small row between"><span>{t('reports.completion')}</span><b>{c.completion_rate ?? '—'}{c.completion_rate != null && '%'}</b></div>
              <Progress value={c.completion_rate || 0} />
              <div className="small row between"><span>{t('classes.attendanceRate')}</span><b>{c.attendance_rate ?? '—'}{c.attendance_rate != null && '%'}</b></div>
              <Progress value={c.attendance_rate || 0} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
