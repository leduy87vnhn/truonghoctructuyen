import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Users } from 'lucide-react';
import { ClassChip, Empty, ErrorBox, PageHead, Spinner, useApi } from '../../ui.jsx';
import { JoinClassModal } from './StudentHome.jsx';

export default function StudentClasses() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/student/classes');
  const [open, setOpen] = useState(false);
  return (
    <div className="stack">
      <PageHead title={t('student.nav.classes')} actions={<button className="btn btn-primary" onClick={() => setOpen(true)}><KeyRound size={17} /> {t('student.joinClass')}</button>} />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={Users} title={t('student.noClasses')} desc={t('student.joinHint')} />
      ) : (
        <div className="grid-cards">
          {data.map((c) => (
            <div key={c.id} className="card row">
              <ClassChip name={c.name} color={c.color} />
              <div className="grow">
                <div className="bold">{c.name}</div>
                <div className="small muted">{c.workspace_name}</div>
                <div className="xs muted">{t('classes.teachers')}: {c.teachers || '—'} · {t('students.code')}: {c.student_code}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <JoinClassModal open={open} onClose={() => setOpen(false)} onJoined={() => { setOpen(false); reload(); }} />
    </div>
  );
}
