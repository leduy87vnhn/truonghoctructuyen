import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Users } from 'lucide-react';
import { Avatar, Badge, Empty, ErrorBox, PageHead, Spinner, useApi } from '../ui.jsx';

export default function Students() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useApi(`/students${search ? `?q=${encodeURIComponent(search)}` : ''}`, [search]);
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHead title={t('nav.students')} sub={t('students.sub')} />
      <form className="input-icon" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <Search size={18} />
        <input className="input" placeholder={t('students.search')} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q)} />
      </form>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={Users} title={t('students.empty')} desc={t('students.emptyDesc')} />
      ) : (
        <div className="card list" style={{ padding: '4px 12px' }}>
          <div className="small muted" style={{ padding: '8px 4px' }}>{t('students.total', { n: data.length })}</div>
          {data.map((s) => (
            <div key={s.id} className="list-item">
              <Avatar name={s.full_name} />
              <div className="grow">
                <div className="bold truncate">{s.full_name}</div>
                <div className="small muted">{s.student_code}{s.guardian_phone ? ` · ${s.guardian_phone}` : ''}</div>
                <div className="row-wrap mt-1">
                  {s.classes.map((c) => (
                    <span key={c.id} className="badge clickable" style={{ background: c.color || 'var(--primary)', color: '#fff' }} onClick={() => nav(`/classes/${c.id}/students`)}>{c.name}</span>
                  ))}
                  {s.has_account && <Badge tone="green">{t('students.hasAccount')}</Badge>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
