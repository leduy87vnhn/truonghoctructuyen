import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, Bell, Camera, ChevronRight, Lock, Sparkles, Trash2, Unlock } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AsyncButton, Avatar, Badge, ErrorBox, fmtDateTime, fmtScore, Modal, PageHead, Spinner, SubmissionBadge, useApi, useConfirm, useErrorText, useToast } from '../ui.jsx';

export default function AssignmentDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const { data: a, loading, error, reload } = useApi(`/assignments/${id}`);
  const [analysis, setAnalysis] = useState(null);
  const [uploadFor, setUploadFor] = useState(null);
  const fileRef = useRef(null);
  const nav = useNavigate();
  const toast = useToast();
  const errText = useErrorText();
  const confirm = useConfirm();

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const submitted = a.students.filter((s) => s.status && s.status !== 'in_progress');
  const toGrade = a.students.filter((s) => ['submitted', 'ai_suggested'].includes(s.status)).length;

  const upload = async (files) => {
    const fd = new FormData();
    fd.append('studentId', uploadFor.student_id);
    for (const f of files) fd.append('images', f);
    try {
      await api.upload(`/grading/assignments/${id}/paper`, fd);
      toast.success(t('grading.uploaded'));
      setUploadFor(null);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const aiAll = async () => {
    try {
      const r = await api.post(`/grading/assignments/${id}/ai-grade-all`);
      toast.success(t('grading.aiQueued', { n: r.queued }));
      setTimeout(reload, 4000);
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const remind = async () => {
    const r = await api.post(`/assignments/${id}/remind`);
    toast.success(t('assignments.reminded', { n: r.reminded }));
  };
  const toggleClose = async () => {
    await api.patch(`/assignments/${id}`, { status: a.status === 'active' ? 'closed' : 'active' });
    reload();
  };
  const remove = async () => {
    if (!(await confirm({ message: t('assignments.deleteConfirm'), danger: true }))) return;
    try {
      await api.del(`/assignments/${id}`);
      nav('/assignments');
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const openAnalysis = async () => setAnalysis(await api.get(`/reports/assignments/${id}/item-analysis`));

  return (
    <div className="stack">
      <PageHead
        back
        title={a.title}
        sub={`${a.class_name} · ${a.exam.title} · ${a.due_at ? fmtDateTime(a.due_at, i18n.language) : t('assignments.noDue')}`}
        actions={
          <>
            <Badge tone={a.mode === 'paper' ? 'yellow' : 'primary'}>{a.mode === 'paper' ? t('assignments.paper') : t('assignments.online')}</Badge>
            {a.status === 'closed' && <Badge>{t('assignments.closed')}</Badge>}
          </>
        }
      />
      <div className="grid-2 grid-4">
        <div className="card stat"><div className="stat-val">{submitted.length}/{a.students.length}</div><div className="stat-label">{t('assignments.submitted')}</div></div>
        <div className="card stat"><div className="stat-val" style={{ color: 'var(--orange)' }}>{toGrade}</div><div className="stat-label">{t('dashboard.pendingGrading')}</div></div>
        <div className="card stat"><div className="stat-val">{a.exam.question_count}</div><div className="stat-label">{t('exams.questions')}</div></div>
        <div className="card stat"><div className="stat-val">{fmtScore(a.exam.total_points)}</div><div className="stat-label">{t('exams.totalPoints')}</div></div>
      </div>
      {a.instructions && <div className="card small pre-wrap">{a.instructions}</div>}

      <div className="row-wrap">
        {can('grade.update') && can('ai.use') && toGrade > 0 && <AsyncButton className="btn btn-gradient" onClick={aiAll}><Sparkles size={17} /> {t('grading.aiAll')}</AsyncButton>}
        {a.mode === 'online' && can('assignment.manage') && <AsyncButton className="btn" onClick={remind}><Bell size={17} /> {t('assignments.remind')}</AsyncButton>}
        {can('report.view') && <AsyncButton className="btn" onClick={openAnalysis}><BarChart3 size={17} /> {t('assignments.analysis')}</AsyncButton>}
        {can('assignment.manage') && <AsyncButton className="btn btn-ghost" onClick={toggleClose}>{a.status === 'active' ? <><Lock size={16} /> {t('assignments.close')}</> : <><Unlock size={16} /> {t('assignments.reopen')}</>}</AsyncButton>}
        {can('assignment.manage') && submitted.length === 0 && <button className="btn btn-ghost" onClick={remove}><Trash2 size={16} color="var(--red)" /></button>}
      </div>
      {a.mode === 'paper' && <div className="ai-box small">{t('grading.paperHelp')}</div>}

      <div className="card list" style={{ padding: '4px 12px' }}>
        {a.students.map((s) => (
          <div key={s.student_id} className="list-item">
            <Avatar name={s.full_name} size="sm" />
            <div className="grow clickable" onClick={() => s.submission_id && s.status !== 'in_progress' && nav(`/grading/submissions/${s.submission_id}`)}>
              <div className="bold truncate">{s.full_name}</div>
              <div className="row-wrap">
                <SubmissionBadge status={s.status} />
                {s.is_late && <Badge tone="red">{t('assignments.late')}</Badge>}
                {s.attachment_count > 0 && <Badge tone="sky"><Camera size={11} /> {s.attachment_count}</Badge>}
              </div>
            </div>
            {s.final_score != null && <b style={{ color: 'var(--primary)' }}>{fmtScore(s.final_score)}/{fmtScore(s.max_score)}</b>}
            {can('grade.update') && (a.mode === 'paper' || s.status === 'in_progress' || !s.status) && s.status !== 'graded' && (
              <button className="btn btn-soft btn-icon btn-sm" title={t('grading.uploadPaper')} onClick={() => { setUploadFor(s); setTimeout(() => fileRef.current?.click(), 50); }}><Camera size={17} /></button>
            )}
            {s.submission_id && s.status !== 'in_progress' && <ChevronRight size={18} className="muted clickable" onClick={() => nav(`/grading/submissions/${s.submission_id}`)} />}
          </div>
        ))}
      </div>
      {/* capture="environment": mở camera sau trên điện thoại để chụp bài làm */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { if (e.target.files.length) upload([...e.target.files]); e.target.value = ''; }} />

      <Modal open={!!analysis} onClose={() => setAnalysis(null)} title={t('assignments.analysis')} size="lg">
        <p className="small muted mb-3">{t('assignments.analysisHint')}</p>
        <div className="stack-sm">
          {analysis?.items.map((it) => (
            <div key={it.id} className="card-flat stack-sm">
              <div className="row between">
                <b>{t('aiExam.question')} {it.position}</b>
                <Badge tone={it.correct_rate == null ? 'gray' : it.correct_rate < 50 ? 'red' : it.correct_rate < 75 ? 'yellow' : 'green'}>{it.correct_rate == null ? '—' : `${it.correct_rate}%`}</Badge>
              </div>
              <div className="small pre-wrap">{it.content.slice(0, 220)}</div>
              {it.topic && <div className="xs muted">{it.topic}</div>}
            </div>
          ))}
        </div>
        {can('ai.use') && (
          <button className="btn btn-gradient btn-block mt-3" onClick={() => nav(`/ai?mode=remedial&assignmentId=${id}`)}><Sparkles size={17} /> {t('assignments.aiRemedial')}</button>
        )}
      </Modal>
    </div>
  );
}
