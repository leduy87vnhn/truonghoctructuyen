import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../api.js';
import { Empty, ErrorBox, fmtDateTime, PageHead, Spinner, useApi } from '../ui.jsx';

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const { data, loading, error, reload } = useApi('/notifications');
  const nav = useNavigate();
  const open = async (n) => {
    if (!n.read_at) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.link) nav(n.link);
    else reload();
  };
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead
        title={t('nav.notifications')}
        actions={data?.unread > 0 && (
          <button className="btn btn-soft btn-sm" onClick={async () => { await api.post('/notifications/read-all'); reload(); }}>
            <CheckCheck size={16} /> {t('notifications.readAll')}
          </button>
        )}
      />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.items.length ? (
        <Empty icon={Bell} title={t('notifications.empty')} />
      ) : (
        <div className="card list" style={{ padding: '4px 12px' }}>
          {data.items.map((n) => (
            <div key={n.id} className="list-item clickable" onClick={() => open(n)}>
              <span className="dot" style={{ background: n.read_at ? 'transparent' : 'var(--pink)' }} />
              <div className="grow">
                <div className={n.read_at ? '' : 'bold'}>{n.title}</div>
                {n.body && <div className="small muted">{n.body}</div>}
                <div className="xs muted mt-1">{fmtDateTime(n.created_at, i18n.language)}{n.workspace_name ? ` · ${n.workspace_name}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
