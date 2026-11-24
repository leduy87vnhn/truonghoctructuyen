import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileSpreadsheet, MoreVertical, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
import { api, download } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { AsyncButton, Avatar, Badge, Empty, ErrorBox, Field, fmtScore, Modal, Spinner, useApi, useConfirm, useErrorText, useToast } from '../../ui.jsx';

function StudentForm({ open, onClose, classId, student, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errText = useErrorText();
  const init = () => ({
    fullName: student?.full_name || '',
    studentCode: student?.student_code || '',
    dob: student?.dob || '',
    gender: student?.gender || '',
    guardianName: student?.guardian_name || '',
    guardianPhone: student?.guardian_phone || '',
    guardianEmail: student?.guardian_email || '',
  });
  const [f, setF] = useState(init);
  const [key, setKey] = useState(null);
  if (open && key !== (student?.id || 'new')) {
    setKey(student?.id || 'new');
    setF(init());
  }
  if (!open && key) setKey(null);
  const save = async () => {
    try {
      const body = { ...f, studentCode: f.studentCode || null, dob: f.dob || null, gender: f.gender || null };
      if (student) await api.patch(`/classes/${classId}/students/${student.id}`, body);
      else await api.post(`/classes/${classId}/students`, body);
      toast.success(t('common.saved'));
      onSaved();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={student ? t('students.edit') : t('students.add')}>
      <div className="stack">
        <Field label={t('auth.fullName')}><input className="input" value={f.fullName} onChange={set('fullName')} autoFocus /></Field>
        <div className="grid-2">
          <Field label={t('students.code')} hint={!student && t('students.codeAuto')}><input className="input" value={f.studentCode} onChange={set('studentCode')} /></Field>
          <Field label={t('students.dob')}><input className="input" type="date" value={f.dob} onChange={set('dob')} /></Field>
        </div>
        <Field label={t('students.gender')}>
          <select className="select" value={f.gender} onChange={set('gender')}>
            <option value="">—</option>
            <option value="female">{t('students.female')}</option>
            <option value="male">{t('students.male')}</option>
            <option value="other">{t('students.other')}</option>
          </select>
        </Field>
        <Field label={t('students.guardian')}><input className="input" value={f.guardianName} onChange={set('guardianName')} /></Field>
        <div className="grid-2">
          <Field label={t('students.guardianPhone')}><input className="input" type="tel" value={f.guardianPhone} onChange={set('guardianPhone')} /></Field>
          <Field label={t('students.guardianEmail')}><input className="input" type="email" value={f.guardianEmail} onChange={set('guardianEmail')} /></Field>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <AsyncButton className="btn btn-primary" onClick={save} disabled={!f.fullName.trim()}>{t('common.save')}</AsyncButton>
      </div>
    </Modal>
  );
}

export default function ClassStudents({ cls, reloadClass }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, loading, error, reload } = useApi(`/classes/${cls.id}/students`);
  const [form, setForm] = useState(null); // null | 'new' | student
  const [importOpen, setImportOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const fileRef = useRef(null);
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();
  const canEdit = cls.can_manage && can('student.manage');

  const doImport = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.upload(`/classes/${cls.id}/students/import`, fd);
      toast.success(t('students.imported', r));
      setImportOpen(false);
      reload();
      reloadClass();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remove = async (s) => {
    if (!(await confirm({ message: t('students.removeConfirm', { name: s.full_name }), danger: true }))) return;
    await api.del(`/classes/${cls.id}/students/${s.id}`);
    reload();
    reloadClass();
  };

  return (
    <div className="stack">
      {canEdit && (
        <div className="row-wrap">
          <button className="btn btn-primary" onClick={() => setForm('new')}><Plus size={18} /> {t('students.add')}</button>
          <button className="btn" onClick={() => setImportOpen(true)}><FileSpreadsheet size={18} /> {t('students.importExcel')}</button>
        </div>
      )}
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={Users} title={t('students.emptyClass')} desc={t('students.emptyClassDesc', { code: cls.join_code })} />
      ) : (
        <div className="card list" style={{ padding: '4px 12px' }}>
          {data.map((s) => (
            <div key={s.id} className="list-item">
              <Avatar name={s.full_name} />
              <div className="grow">
                <div className="bold truncate">{s.full_name}</div>
                <div className="small muted">
                  {s.student_code}
                  {s.absent_count > 0 && ` · ${t('students.absentN', { n: s.absent_count })}`}
                  {s.has_account && <> · <Badge tone="green">{t('students.hasAccount')}</Badge></>}
                </div>
              </div>
              <div className="center" style={{ minWidth: 48 }}>
                <div className="bold" style={{ color: s.average == null ? 'var(--muted)' : s.average < 5 ? 'var(--red)' : s.average >= 8 ? 'var(--green)' : 'var(--text)' }}>{fmtScore(s.average)}</div>
                <div className="xs muted">{t('students.avg')}</div>
              </div>
              {canEdit && (
                <div className="dropdown">
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMenu(menu === s.id ? null : s.id)} aria-label="menu"><MoreVertical size={18} /></button>
                  {menu === s.id && (
                    <div className="menu" onMouseLeave={() => setMenu(null)}>
                      <button onClick={() => { setMenu(null); setForm(s); }}><Pencil size={16} /> {t('common.edit')}</button>
                      <button onClick={() => { setMenu(null); remove(s); }} style={{ color: 'var(--red)' }}><Trash2 size={16} /> {t('students.remove')}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <StudentForm open={!!form} onClose={() => setForm(null)} classId={cls.id} student={form === 'new' ? null : form} onSaved={() => { setForm(null); reload(); reloadClass(); }} />

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={t('students.importExcel')}>
        <div className="stack">
          <p className="small muted">{t('students.importHelp')}</p>
          <button className="btn btn-soft" onClick={() => download(`/classes/${cls.id}/students-template`, 'mau-danh-sach-hoc-sinh.xlsx')}>
            <Download size={18} /> {t('students.downloadTemplate')}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files[0] && doImport(e.target.files[0])} />
          <button className="btn btn-primary btn-lg" onClick={() => fileRef.current.click()}><Upload size={18} /> {t('students.chooseFile')}</button>
        </div>
      </Modal>
    </div>
  );
}
