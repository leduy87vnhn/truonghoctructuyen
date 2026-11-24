import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, History, Lock, Plus, Unlock } from 'lucide-react';
import { api, download } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { AsyncButton, Empty, ErrorBox, Field, fmtDateTime, fmtScore, Modal, Spinner, useApi, useErrorText, useToast } from '../../ui.jsx';

const CATS = ['oral', 'quiz', 'test', 'midterm', 'final', 'assignment', 'other'];

function GradeCell({ value, locked, max, onSave }) {
  const [v, setV] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setV(value ?? '');
  }
  const commit = () => {
    const s = String(v).trim().replace(',', '.');
    const num = s === '' ? null : Number(s);
    if (num === (value ?? null)) return;
    if (num !== null && (isNaN(num) || num < 0 || num > max)) {
      setV(value ?? '');
      return;
    }
    onSave(num);
  };
  if (locked) return <span className="bold">{fmtScore(value)}</span>;
  return (
    <input
      className="grade-input"
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

export default function ClassGradebook({ cls }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload, setData } = useApi(`/classes/${cls.id}/gradebook`);
  const [itemForm, setItemForm] = useState(null);
  const [history, setHistory] = useState(null);
  const toast = useToast();
  const errText = useErrorText();
  const canEdit = cls.can_manage && can('grade.update');

  const saveGrade = async (item, student, score) => {
    try {
      await api.put(`/classes/${cls.id}/grades`, { gradeItemId: item.id, studentId: student.id, score });
      setData((d) => ({
        ...d,
        students: d.students.map((s) => (s.id === student.id ? { ...s, grades: { ...s.grades, [item.id]: score } } : s)),
      }));
      reload();
    } catch (e) {
      toast.error(errText(e));
      reload();
    }
  };
  const saveItem = async () => {
    try {
      const body = { name: itemForm.name, category: itemForm.category, weight: Number(itemForm.weight), maxScore: Number(itemForm.maxScore) };
      if (itemForm.id) await api.patch(`/classes/${cls.id}/grade-items/${itemForm.id}`, body);
      else await api.post(`/classes/${cls.id}/grade-items`, body);
      setItemForm(null);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const toggleLock = async (item) => {
    try {
      await api.patch(`/classes/${cls.id}/grade-items/${item.id}`, { locked: !item.locked });
      toast.success(item.locked ? t('gradebook.unlocked') : t('gradebook.locked'));
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const deleteItem = async () => {
    try {
      await api.del(`/classes/${cls.id}/grade-items/${itemForm.id}`);
      setItemForm(null);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const openHistory = async () => setHistory(await api.get(`/classes/${cls.id}/grades/history`));

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="stack">
      <div className="row-wrap">
        {canEdit && <button className="btn btn-primary" onClick={() => setItemForm({ name: '', category: 'oral', weight: 1, maxScore: 10 })}><Plus size={18} /> {t('gradebook.addColumn')}</button>}
        <button className="btn" onClick={openHistory}><History size={18} /> {t('gradebook.history')}</button>
        {can('report.view') && <button className="btn" onClick={() => download(`/classes/${cls.id}/gradebook/export`, `so-diem-${cls.name}.xlsx`)}><Download size={18} /> Excel</button>}
      </div>
      {data.students.length === 0 ? (
        <Empty title={t('students.emptyClass')} />
      ) : data.items.length === 0 ? (
        <Empty title={t('gradebook.noColumns')} desc={t('gradebook.noColumnsDesc')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="sticky-col">{t('gradebook.student')}</th>
                {data.items.map((i) => (
                  <th key={i.id} className="center" style={{ maxWidth: 130, whiteSpace: 'normal' }}>
                    <button className="btn btn-ghost btn-sm" title={i.name} style={{ padding: '0 4px', minHeight: 0, textTransform: 'none', fontWeight: 700, whiteSpace: 'normal', lineHeight: 1.3, display: 'block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: '2.6em' }} disabled={!canEdit} onClick={() => setItemForm({ id: i.id, name: i.name, category: i.category, weight: i.weight, maxScore: i.max_score, locked: i.locked, assignment_id: i.assignment_id })}>
                      {i.locked && <Lock size={12} />} {i.name}
                    </button>
                    <div className="xs muted" style={{ textTransform: 'none', fontWeight: 500 }}>{t(`gradebook.cat.${i.category}`)} · x{i.weight}</div>
                  </th>
                ))}
                <th className="center">{t('students.avg')}</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.id}>
                  <td className="sticky-col"><div className="bold">{s.full_name}</div><div className="xs muted">{s.student_code}</div></td>
                  {data.items.map((i) => (
                    <td key={i.id} className="center">
                      <GradeCell value={s.grades[i.id] ?? null} locked={!canEdit || i.locked} max={i.max_score} onSave={(v) => saveGrade(i, s, v)} />
                    </td>
                  ))}
                  <td className="center bold" style={{ color: s.average == null ? 'var(--muted)' : s.average < 5 ? 'var(--red)' : 'var(--primary)' }}>{fmtScore(s.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="xs muted">{t('gradebook.hint')}</p>

      <Modal open={!!itemForm} onClose={() => setItemForm(null)} title={itemForm?.id ? t('gradebook.editColumn') : t('gradebook.addColumn')}>
        {itemForm && (
          <div className="stack">
            <Field label={t('gradebook.columnName')}><input className="input" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} disabled={itemForm.locked} /></Field>
            <Field label={t('gradebook.category')}>
              <select className="select" value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} disabled={itemForm.locked}>
                {CATS.map((c) => <option key={c} value={c}>{t(`gradebook.cat.${c}`)}</option>)}
              </select>
            </Field>
            <div className="grid-2">
              <Field label={t('gradebook.weight')}><input className="input" type="number" min="0" max="10" step="0.5" value={itemForm.weight} onChange={(e) => setItemForm({ ...itemForm, weight: e.target.value })} disabled={itemForm.locked} /></Field>
              <Field label={t('gradebook.maxScore')}><input className="input" type="number" min="1" value={itemForm.maxScore} onChange={(e) => setItemForm({ ...itemForm, maxScore: e.target.value })} disabled={itemForm.locked} /></Field>
            </div>
            {itemForm.id && can('grade.lock') && (
              <button className="btn btn-soft" onClick={() => { toggleLock(itemForm); setItemForm(null); }}>
                {itemForm.locked ? <><Unlock size={16} /> {t('gradebook.unlock')}</> : <><Lock size={16} /> {t('gradebook.lock')}</>}
              </button>
            )}
            <div className="modal-foot">
              {itemForm.id && !itemForm.locked && !itemForm.assignment_id && <AsyncButton className="btn btn-danger" onClick={deleteItem}>{t('common.delete')}</AsyncButton>}
              <AsyncButton className="btn btn-primary" onClick={saveItem} disabled={!itemForm.name.trim() || itemForm.locked}>{t('common.save')}</AsyncButton>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title={t('gradebook.history')}>
        {history?.length === 0 && <p className="muted">{t('gradebook.noHistory')}</p>}
        <div className="list">
          {history?.map((h) => (
            <div key={h.id} className="list-item">
              <div className="grow">
                <div className="small"><b>{h.student_name}</b> · {h.item_name}: {fmtScore(h.old_score)} → <b>{fmtScore(h.new_score)}</b></div>
                <div className="xs muted">{h.changed_by_name || 'Hệ thống'} · {fmtDateTime(h.changed_at, i18n.language)}{h.reason ? ` · ${h.reason}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
