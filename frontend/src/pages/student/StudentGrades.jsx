import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { Empty, ErrorBox, fmtScore, PageHead, Spinner, useApi } from '../../ui.jsx';

export default function StudentGrades() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/student/grades');
  return (
    <div className="stack">
      <PageHead title={t('student.nav.grades')} />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={Star} title={t('student.noGrades')} />
      ) : data.map((c) => (
        <div key={c.class_id} className="card">
          <div className="card-head">
            <h3 className="row"><span className="dot" style={{ background: c.color || 'var(--primary)', width: 12, height: 12 }} /> {c.class_name}</h3>
            <div className="center"><div className="stat-val" style={{ fontSize: '1.3rem', color: 'var(--primary)' }}>{fmtScore(c.average)}</div><div className="xs muted">{t('students.avg')}</div></div>
          </div>
          <div className="list">
            {c.items.map((i) => (
              <div key={i.id} className="list-item">
                <div className="grow"><div className="small bold">{i.name}</div><div className="xs muted">x{i.weight}</div></div>
                <b>{fmtScore(i.score)}</b><span className="xs muted">/{fmtScore(i.max_score)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
