import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, ChevronRight, ClipboardCheck, Monitor, Sparkles } from 'lucide-react';
import { Avatar, Badge, Empty, ErrorBox, fmtScore, PageHead, Spinner, SubmissionBadge, Tabs, useApi } from '../ui.jsx';

const TAB_FIELD = { pending: 'pending', review: 'review', graded: 'graded' };
const TAB_STATUSES = { pending: ['submitted', 'ai_processing'], review: ['ai_suggested'], graded: ['graded'] };

function SubmissionList({ assignmentId, tab }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi(`/grading/assignments/${assignmentId}/submissions`);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const list = data.filter((s) => TAB_STATUSES[tab].includes(s.status));
  if (!list.length) return <p className="small muted" style={{ padding: 12 }}>{t('grading.noneInTab')}</p>;
  return (
    <div className="list">
      {list.map((s) => (
        <div key={s.id} className="list-item clickable" onClick={() => nav(`/grading/submissions/${s.id}`)}>
          <Avatar name={s.full_name} size="sm" />
          <div className="grow">
            <div className="bold truncate">{s.full_name}</div>
            <div className="row-wrap">
              <SubmissionBadge status={s.status} />
              {s.attachment_count > 0 && <Badge tone="sky"><Camera size={11} /> {s.attachment_count}</Badge>}
              {s.ai_error && <Badge tone="red">AI ✕</Badge>}
            </div>
          </div>
          <span className="small">{s.final_score != null ? <b>{fmtScore(s.final_score)}</b> : s.auto_score != null ? <span className="muted">{t('grading.auto')}: {fmtScore(s.auto_score)}</span> : null}</span>
          <ChevronRight size={18} className="muted" />
        </div>
      ))}
    </div>
  );
}

export default function Grading() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'pending';
  const selected = params.get('assignment');
  const { data, loading, error, reload } = useApi('/grading/queue');
  const nav = useNavigate();
  const set = (patch) => setParams({ tab, ...(selected && { assignment: selected }), ...patch });

  const totals = data ? data.items.reduce((o, a) => ({ pending: o.pending + a.pending, review: o.review + a.review, graded: o.graded + a.graded }), { pending: 0, review: 0, graded: 0 }) : {};
  const items = data ? data.items.filter((a) => a[TAB_FIELD[tab]] > 0 || (tab === 'pending' && a.mode === 'paper')) : [];

  return (
    <div className="stack">
      <PageHead title={t('grading.title')} sub={data ? t('grading.waiting', { n: totals.pending + totals.review }) : ''} />
      <Tabs
        value={tab}
        onChange={(k) => setParams({ tab: k })}
        tabs={[
          { key: 'pending', label: t('grading.tab.pending'), badge: totals.pending },
          { key: 'review', label: t('grading.tab.review'), badge: totals.review },
          { key: 'graded', label: t('grading.tab.graded'), badge: totals.graded },
        ]}
      />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : items.length === 0 ? (
        <Empty icon={ClipboardCheck} title={t('grading.empty')} desc={t('grading.emptyDesc')} />
      ) : (
        <div className="stack-sm">
          {items.map((a) => (
            <div key={a.id} className="card">
              <div className="row clickable" onClick={() => set({ assignment: selected === a.id ? '' : a.id })}>
                <div className={`stat-ic tone-${a.mode === 'paper' ? 'yellow' : a.essay_count > 0 ? 'orange' : 'primary'}`}>
                  {a.mode === 'paper' ? <Camera size={18} /> : <Monitor size={18} />}
                </div>
                <div className="grow">
                  <div className="bold truncate">{a.title}</div>
                  <div className="small muted">
                    <span style={{ color: a.class_color || 'var(--primary)', fontWeight: 700 }}>{a.class_name}</span> · {a.mode === 'paper' ? t('grading.method.paper') : a.essay_count > 0 ? t('grading.method.essay') : t('grading.method.mcq')}
                    {' · '}{t(`grading.count.${tab}`, { n: a[TAB_FIELD[tab]] })}
                  </div>
                </div>
                {a.mode === 'paper' && tab === 'pending' && (
                  <button className="btn btn-soft btn-sm" onClick={(e) => { e.stopPropagation(); nav(`/assignments/${a.id}`); }}><Camera size={15} /> {t('grading.capture')}</button>
                )}
                <ChevronRight size={18} className="muted" style={{ transform: selected === a.id ? 'rotate(90deg)' : 'none', transition: '0.15s' }} />
              </div>
              {selected === a.id && <div className="mt-2"><SubmissionList assignmentId={a.id} tab={tab} /></div>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3 className="mb-2">{t('grading.methods')}</h3>
        <div className="grid-2 grid-4">
          {[[Monitor, 'online', 'primary'], [Camera, 'photo', 'yellow'], [Sparkles, 'ai', 'pink'], [ClipboardCheck, 'review', 'green']].map(([Icon, k, tone]) => (
            <div key={k} className="stack-sm">
              <div className={`stat-ic tone-${tone}`}><Icon size={18} /></div>
              <div className="bold small">{t(`grading.methodCard.${k}`)}</div>
              <div className="xs muted">{t(`grading.methodCard.${k}Desc`)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
