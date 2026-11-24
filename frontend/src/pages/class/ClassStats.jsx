import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ErrorBox, fmtScore, Progress, Spinner, useApi } from '../../ui.jsx';

const DIST = [
  ['excellent', 'var(--green)'],
  ['good', 'var(--sky)'],
  ['average', 'var(--yellow)'],
  ['weak', 'var(--red)'],
  ['none', '#cfd3e0'],
];

export default function ClassStats({ cls }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi(`/classes/${cls.id}/stats`);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const max = Math.max(1, ...DIST.map(([k]) => data.distribution[k]));
  const att = data.attendance;
  const attTotal = att.present + att.absent + att.late + att.excused;

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="card stat">
          <div className="stat-label">{t('stats.classAverage')}</div>
          <div className="stat-val" style={{ color: 'var(--primary)' }}>{fmtScore(data.class_average)}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">{t('classes.attendanceRate')}</div>
          <div className="stat-val" style={{ color: 'var(--green)' }}>{attTotal ? `${Math.round(((att.present + att.late) / attTotal) * 100)}%` : '—'}</div>
        </div>
      </div>

      <div className="card">
        <h3>{t('stats.distribution')}</h3>
        <div className="bars">
          {DIST.map(([k, color]) => (
            <div key={k} className="b">
              <span className="bold small">{data.distribution[k]}</span>
              <div className="fill" style={{ height: `${(data.distribution[k] / max) * 100}%`, background: color }} />
              <span className="xs muted center">{t(`stats.dist.${k}`)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-2">{t('stats.assignments')}</h3>
        {data.assignments.length === 0 ? <p className="small muted">{t('assignments.empty')}</p> : (
          <div className="list">
            {data.assignments.map((a) => (
              <div key={a.id} className="list-item clickable" onClick={() => nav(`/assignments/${a.id}`)} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row between">
                  <span className="bold truncate">{a.title}</span>
                  <span className="small">{t('stats.avg')}: <b>{fmtScore(a.avg_score)}</b></span>
                </div>
                <Progress value={a.total ? (a.submitted / a.total) * 100 : 0} />
                <span className="xs muted">{t('assignments.submittedN', { n: a.submitted, total: a.total })} · {t('stats.gradedN', { n: a.graded })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid-cards">
        <div className="card">
          <h3 className="mb-2">🏆 {t('stats.top')}</h3>
          {data.top_students.length === 0 ? <p className="small muted">—</p> : data.top_students.map((s, i) => (
            <div key={s.id} className="row between small" style={{ padding: '6px 0' }}><span>{i + 1}. {s.full_name}</span><b>{fmtScore(s.average)}</b></div>
          ))}
        </div>
        <div className="card">
          <h3 className="mb-2">💡 {t('stats.needSupport')}</h3>
          {data.need_support.length === 0 ? <p className="small muted">{t('stats.noneNeedSupport')}</p> : data.need_support.map((s) => (
            <div key={s.id} className="row between small" style={{ padding: '6px 0' }}><span>{s.full_name}</span><b style={{ color: 'var(--red)' }}>{fmtScore(s.average)}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}
