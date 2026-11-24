import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck, UserCheck } from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { AsyncButton, Empty, ErrorBox, fmtDate, Spinner, useApi, useErrorText, useToast } from '../../ui.jsx';

const STATUSES = ['present', 'absent', 'late', 'excused'];
const localToday = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function ClassAttendance({ cls }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [date, setDate] = useState(localToday());
  const { data, loading, error, reload } = useApi(`/classes/${cls.id}/attendance?date=${date}`, [date]);
  const [marks, setMarks] = useState({});
  const [dirty, setDirty] = useState(false);
  const toast = useToast();
  const errText = useErrorText();
  const canEdit = cls.can_manage && can('attendance.manage');

  useEffect(() => {
    if (!data) return;
    const m = {};
    for (const r of data.records) m[r.student_id] = r.status || null;
    setMarks(m);
    setDirty(false);
  }, [data]);

  const set = (id, s) => {
    setMarks((m) => ({ ...m, [id]: s }));
    setDirty(true);
  };
  const allPresent = () => {
    const m = {};
    for (const r of data.records) m[r.student_id] = marks[r.student_id] || 'present';
    setMarks(m);
    setDirty(true);
  };
  const save = async () => {
    const records = Object.entries(marks).filter(([, s]) => s).map(([studentId, status]) => ({ studentId, status }));
    try {
      await api.put(`/classes/${cls.id}/attendance`, { date, records });
      toast.success(t('attendance.saved'));
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const counts = STATUSES.reduce((o, s) => ({ ...o, [s]: Object.values(marks).filter((x) => x === s).length }), {});

  return (
    <div className="stack">
      <div className="row-wrap between">
        <input className="input" type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 200 }} />
        {canEdit && data?.records.length > 0 && <button className="btn btn-soft btn-sm" onClick={allPresent}><CheckCheck size={16} /> {t('attendance.allPresent')}</button>}
      </div>
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.records.length === 0 ? (
        <Empty icon={UserCheck} title={t('students.emptyClass')} />
      ) : (
        <>
          <div className="row-wrap">
            {STATUSES.map((s) => (
              <span key={s} className={`badge tone-${{ present: 'green', absent: 'red', late: 'yellow', excused: 'sky' }[s]}`}>{t(`attendance.${s}`)}: {counts[s]}</span>
            ))}
          </div>
          <div className="card list" style={{ padding: '4px 12px' }}>
            {data.records.map((r, i) => (
              <div key={r.student_id} className="list-item">
                <span className="muted small" style={{ width: 22 }}>{i + 1}</span>
                <div className="grow">
                  <div className="bold truncate">{r.full_name}</div>
                  <div className="xs muted">{r.student_code}</div>
                </div>
                <div className="att-btns">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      disabled={!canEdit}
                      className={`att-btn ${s} ${marks[r.student_id] === s ? 'on' : ''}`}
                      title={t(`attendance.${s}`)}
                      onClick={() => set(r.student_id, marks[r.student_id] === s ? null : s)}
                    >
                      {t(`attendance.short.${s}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="sticky-bottom row between">
              <span className="small muted">{dirty ? t('attendance.unsaved') : fmtDate(date, i18n.language)}</span>
              <AsyncButton className="btn btn-primary" onClick={save} disabled={!dirty}>{t('common.save')}</AsyncButton>
            </div>
          )}
          {data.history.length > 0 && (
            <div className="card">
              <h3 className="mb-2">{t('attendance.history')}</h3>
              <div className="row-wrap">
                {data.history.map((h) => (
                  <button key={h.date} className={`chip ${h.date === date ? 'active' : ''}`} onClick={() => setDate(h.date)}>
                    {fmtDate(h.date, i18n.language)} · {h.present}/{h.total}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
