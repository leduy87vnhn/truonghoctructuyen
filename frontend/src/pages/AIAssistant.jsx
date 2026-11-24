import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { Copy, FileQuestion, Send, Sparkles, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { Avatar, ErrorBox, PageHead, Spinner, useApi, useErrorText, useToast } from '../ui.jsx';
import { useAuth } from '../auth.jsx';

const MODES = ['lesson_plan', 'remedial', 'feedback', 'free'];

export default function AIAssistant() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const status = useApi('/ai/status');
  const assignments = useApi('/assignments');
  const [mode, setMode] = useState(params.get('mode') || 'lesson_plan');
  const [assignmentId, setAssignmentId] = useState(params.get('assignmentId') || '');
  const [prompt, setPrompt] = useState('');
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const errText = useErrorText();
  const nav = useNavigate();
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const send = async (text) => {
    const p = (text ?? prompt).trim();
    if (!p) return;
    setChat((c) => [...c, { role: 'user', text: p }]);
    setPrompt('');
    setBusy(true);
    try {
      const r = await api.post('/ai/assistant', { mode, prompt: p, assignmentId: mode === 'remedial' && assignmentId ? assignmentId : null });
      setChat((c) => [...c, { role: 'ai', text: r.answer }]);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead title={<span className="row"><Sparkles color="var(--primary)" /> {t('nav.ai')}</span>} sub={t('ai.sub')} />
      {status.data && !status.data.enabled && <div className="form-error">{t('errors.AI_DISABLED')}</div>}
      {status.error && <ErrorBox error={status.error} />}

      <div className="grid-2">
        <button className="card clickable row" style={{ border: 0, textAlign: 'left' }} onClick={() => nav('/exams/ai')}>
          <div className="stat-ic tone-pink"><Wand2 size={20} /></div>
          <div><div className="bold small">{t('nav.aiExam')}</div><div className="xs muted">{t('ai.examShortcut')}</div></div>
        </button>
        <button className="card clickable row" style={{ border: 0, textAlign: 'left' }} onClick={() => nav('/questions')}>
          <div className="stat-ic tone-sky"><FileQuestion size={20} /></div>
          <div><div className="bold small">{t('ai.generateQuestions')}</div><div className="xs muted">{t('ai.questionsShortcut')}</div></div>
        </button>
      </div>

      <div className="chips">
        {MODES.map((m) => <button key={m} className={`chip ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>{t(`ai.mode.${m}`)}</button>)}
      </div>
      {mode === 'remedial' && (
        <select className="select" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
          <option value="">— {t('ai.chooseAssignment')} —</option>
          {(assignments.data || []).map((a) => <option key={a.id} value={a.id}>{a.title} · {a.class_name}</option>)}
        </select>
      )}

      <div className="card stack" style={{ minHeight: 260 }}>
        {chat.length === 0 && (
          <div className="stack-sm">
            <p className="muted small">{t('ai.examplesTitle')}</p>
            {t(`ai.examples.${mode}`, { returnObjects: true }).map((ex) => (
              <button key={ex} className="btn btn-block" style={{ justifyContent: 'flex-start', whiteSpace: 'normal', textAlign: 'left', height: 'auto', padding: 10 }} onClick={() => send(ex)}>💡 {ex}</button>
            ))}
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
            {m.role === 'user' ? <Avatar name={user.full_name} size="sm" /> : <div className="brand-logo" style={{ width: 32, height: 32, borderRadius: 10 }}><Sparkles size={16} /></div>}
            <div className="grow" style={{ background: m.role === 'ai' ? 'var(--surface-2)' : 'transparent', borderRadius: 12, padding: m.role === 'ai' ? '8px 12px' : '4px 0' }}>
              {m.role === 'ai' ? <div className="markdown"><ReactMarkdown>{m.text}</ReactMarkdown></div> : <div className="pre-wrap">{m.text}</div>}
              {m.role === 'ai' && (
                <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(m.text); toast.success(t('common.copied')); }}><Copy size={14} /> {t('common.copy')}</button>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="row small muted"><Spinner small /> {t('ai.thinking')}</div>}
        <div ref={endRef} />
      </div>

      <div className="sticky-bottom row" style={{ alignItems: 'flex-end' }}>
        <textarea
          className="textarea grow"
          style={{ minHeight: 48, maxHeight: 160 }}
          value={prompt}
          placeholder={t('ai.promptPh')}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn btn-gradient btn-icon" style={{ height: 48, width: 48 }} onClick={() => send()} disabled={busy || !prompt.trim() || !status.data?.enabled}><Send size={18} /></button>
      </div>
    </div>
  );
}
