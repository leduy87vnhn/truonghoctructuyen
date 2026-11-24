import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, ChevronRight, ClipboardCheck, GraduationCap, Plus, Send } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Badge, CLASS_COLORS, ClassChip, Empty, ErrorBox, Field, Modal, PageHead, Spinner, useApi, useErrorText, useToast } from '../ui.jsx';

export function ClassForm({ initial = {}, onSaved, onClose, open }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errText = useErrorText();
  const [f, setF] = useState({});
  useEffect(() => {
    if (open) {
      setF({
        name: initial.name || '',
        subject: initial.subject || '',
        gradeLevel: initial.grade_level || '',
        schoolYear: initial.school_year || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
        description: initial.description || '',
        color: initial.color || CLASS_COLORS[Math.floor(Math.random() * CLASS_COLORS.length)],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = async () => {
    try {
      const body = { ...f, subject: f.subject || null, gradeLevel: f.gradeLevel || null, description: f.description || null };
      const r = initial.id ? await api.patch(`/classes/${initial.id}`, body) : await api.post('/classes', body);
      toast.success(t('common.saved'));
      onSaved?.(r);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={initial.id ? t('classes.edit') : t('classes.create')}>
      <div className="stack">
        <Field label={t('classes.name')}>
          <input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Toán 8A1" autoFocus />
        </Field>
        <div className="grid-2">
          <Field label={t('common.subject')}><input className="input" value={f.subject || ''} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label={t('common.gradeLevel')}><input className="input" value={f.gradeLevel || ''} onChange={(e) => setF({ ...f, gradeLevel: e.target.value })} /></Field>
        </div>
        <Field label={t('classes.schoolYear')}><input className="input" value={f.schoolYear || ''} onChange={(e) => setF({ ...f, schoolYear: e.target.value })} /></Field>
        <Field label={t('common.description')}><textarea className="textarea" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={t('classes.color')}>
          <div className="row-wrap">
            {CLASS_COLORS.map((c) => (
              <button key={c} onClick={() => setF({ ...f, color: c })} style={{ width: 32, height: 32, borderRadius: 10, background: c, border: f.color === c ? '3px solid var(--text)' : '3px solid transparent', cursor: 'pointer' }} aria-label={c} />
            ))}
          </div>
        </Field>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <AsyncButton className="btn btn-primary" onClick={save} disabled={!f.name?.trim()}>{t('common.save')}</AsyncButton>
      </div>
    </Modal>
  );
}

export default function Classes() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [archived, setArchived] = useState(false);
  const { data, loading, error, reload } = useApi(`/classes${archived ? '?archived=1' : ''}`, [archived]);
  const nav = useNavigate();
  const creating = params.get('new') === '1';
  const pick = params.get('pick'); // vd: chọn lớp để điểm danh

  return (
    <div className="stack">
      <PageHead
        title={t('nav.classes')}
        sub={pick === 'attendance' ? t('classes.pickForAttendance') : t('classes.sub')}
        actions={
          <>
            <button className={`chip ${archived ? 'active' : ''}`} onClick={() => setArchived(!archived)}><Archive size={15} /> {t('classes.showArchived')}</button>
            {can('class.create') && <button className="btn btn-primary desktop-only" onClick={() => setParams({ new: '1' })}><Plus size={18} /> {t('classes.create')}</button>}
          </>
        }
      />
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty icon={GraduationCap} title={t('classes.empty')} desc={can('class.create') ? t('classes.emptyDesc') : t('classes.emptyAssigned')}
          action={can('class.create') && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus size={18} /> {t('classes.create')}</button>} />
      ) : (
        <div className="grid-cards">
          {data.map((c) => (
            <div key={c.id} className="card clickable stack-sm" onClick={() => nav(`/classes/${c.id}${pick ? `/${pick}` : ''}`)}>
              <div className="row">
                <ClassChip name={c.name} color={c.color} />
                <div className="grow">
                  <div className="bold truncate">{c.name}</div>
                  <div className="small muted truncate">{[c.subject, c.school_year].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <ChevronRight size={18} className="muted" />
              </div>
              <div className="row-wrap">
                <Badge tone="sky">{t('classes.nStudents', { n: c.student_count })}</Badge>
                {c.active_assignments > 0 && <Badge tone="green"><Send size={12} /> {c.active_assignments}</Badge>}
                {c.pending_grading > 0 && <Badge tone="orange"><ClipboardCheck size={12} /> {t('classes.nToGrade', { n: c.pending_grading })}</Badge>}
                {c.archived && <Badge>{t('classes.archived')}</Badge>}
              </div>
              {c.teachers?.length > 0 && <div className="xs muted truncate">{t('classes.teachers')}: {c.teachers.map((x) => x.full_name).join(', ')}</div>}
            </div>
          ))}
        </div>
      )}
      {can('class.create') && <button className="fab" onClick={() => setParams({ new: '1' })} aria-label={t('classes.create')}><Plus size={26} /></button>}
      <ClassForm open={creating} onClose={() => setParams({})} onSaved={(c) => { setParams({}); nav(`/classes/${c.id}`); }} />
    </div>
  );
}
