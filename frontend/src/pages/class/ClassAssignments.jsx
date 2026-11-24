import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Plus } from 'lucide-react';
import { useAuth } from '../../auth.jsx';
import { Empty, ErrorBox, Spinner, useApi } from '../../ui.jsx';
import AssignModal from '../AssignModal.jsx';
import { AssignmentRow } from '../Assignments.jsx';

export default function ClassAssignments({ cls, reloadClass }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi(`/assignments?classId=${cls.id}`);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div className="stack">
      {cls.can_manage && can('assignment.manage') && (
        <div className="row-wrap">
          {/* Tạo bài mới ngay trong lớp: lớp được chọn sẵn */}
          <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={18} /> {t('assignments.assign')}</button>
          {can('exam.manage') && <button className="btn" onClick={() => nav('/exams?new=1')}>{t('exams.create')}</button>}
        </div>
      )}
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={ClipboardList} title={t('assignments.empty')} desc={t('assignments.emptyClassDesc')} />
      ) : (
        <div className="card list" style={{ padding: '4px 12px' }}>
          {data.map((a) => <AssignmentRow key={a.id} a={a} hideClass />)}
        </div>
      )}
      <AssignModal open={open} onClose={() => setOpen(false)} classId={cls.id} onDone={() => { setOpen(false); reload(); reloadClass(); }} />
    </div>
  );
}
