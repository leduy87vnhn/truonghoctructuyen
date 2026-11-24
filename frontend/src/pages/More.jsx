import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, Building2, ChartColumn, FileQuestion, Library, Settings, ShieldCheck, Sparkles, Users, UsersRound, Wand2 } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { PageHead } from '../ui.jsx';

// Màn hình "Tiện ích" trên mobile: gom các chức năng ít dùng hơn
export default function More() {
  const { t } = useTranslation();
  const { can, workspace, isAdmin } = useAuth();
  const items = [
    workspace && { to: '/exams/ai', icon: Wand2, label: t('nav.aiExam'), tone: 'pink' },
    workspace && { to: '/ai', icon: Sparkles, label: t('nav.ai'), tone: 'primary' },
    workspace && { to: '/questions', icon: FileQuestion, label: t('nav.questionBank'), tone: 'sky' },
    workspace && { to: '/teaching', icon: BookOpen, label: t('nav.teaching'), tone: 'green' },
    workspace && { to: '/students', icon: Users, label: t('nav.students'), tone: 'orange' },
    workspace && can('report.view') && { to: '/reports', icon: ChartColumn, label: t('nav.reports'), tone: 'yellow' },
    workspace?.type === 'organization' && (can('member.manage') || can('report.view_org') || can('class.manage_all')) && { to: '/org', icon: Building2, label: t('nav.org'), tone: 'pink' },
    isAdmin && { to: '/admin/users', icon: UsersRound, label: t('nav.users'), tone: 'red' },
    isAdmin && { to: '/admin/system', icon: ShieldCheck, label: t('nav.system'), tone: 'gray' },
    { to: '/workspaces', icon: Library, label: t('nav.workspaces'), tone: 'primary' },
    { to: '/settings', icon: Settings, label: t('nav.settings'), tone: 'gray' },
  ].filter(Boolean);
  return (
    <div className="stack">
      <PageHead title={t('nav.more')} />
      <div className="grid-2">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="card clickable stack-sm" style={{ color: 'var(--text)' }}>
            <div className={`stat-ic tone-${i.tone}`}><i.icon size={20} /></div>
            <div className="bold small">{i.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
