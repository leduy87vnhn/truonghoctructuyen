import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell, BookOpen, Building2, ChartColumn, Check, ChevronDown, ClipboardCheck, ClipboardList, GraduationCap, Grid2x2, Home, Library, LogOut, Plus, Settings as SettingsIcon, ShieldCheck,
  Sparkles, Star, User, Users, UsersRound,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Avatar, colorFor, initials } from '../ui.jsx';

function Brand() {
  return (
    <div className="brand">
      <div className="brand-logo"><GraduationCap size={20} /></div>
      <span>Teacher<span style={{ color: 'var(--primary)' }}>WS</span></span>
    </div>
  );
}

export function wsLabel(ws, t) {
  if (!ws) return '';
  return ws.type === 'personal' ? t('workspace.personal') : ws.name;
}

function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const { workspaces, workspace, switchWorkspace } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!workspace) return null;
  const staff = workspaces.filter((w) => !['student', 'parent'].includes(w.role_key));
  const dot = (w) => (
    <div className="ws-dot" style={{ background: w.type === 'personal' ? 'var(--gradient)' : colorFor(w.name) }}>
      {w.type === 'personal' ? <User size={15} /> : initials(w.name)}
    </div>
  );
  return (
    <div className="dropdown grow" ref={ref} style={{ minWidth: 0 }}>
      <button className="ws-switch" onClick={() => setOpen(!open)}>
        {dot(workspace)}
        <div className="truncate" style={{ textAlign: 'left' }}>
          <div className="bold small truncate">{wsLabel(workspace, t)}</div>
          <div className="xs muted truncate">{t(`roles.${workspace.role_key}`, { defaultValue: workspace.role_name })}</div>
        </div>
        <ChevronDown size={16} className="muted" />
      </button>
      {open && (
        <div className="menu ws-menu">
          <div className="side-label" style={{ paddingTop: 4 }}>{t('workspace.switch')}</div>
          {staff.map((w) => (
            <button
              key={w.id}
              className={`ws-item ${w.id === workspace.id ? 'active' : ''}`}
              onClick={() => {
                switchWorkspace(w.id);
                setOpen(false);
                nav('/');
              }}
            >
              {dot(w)}
              <div className="grow">
                <div className="bold small">{wsLabel(w, t)}</div>
                <div className="xs muted">
                  {w.type === 'personal' ? t('workspace.personalDesc') : t(`workspace.kind.${w.org_kind}`)} · {t(`roles.${w.role_key}`, { defaultValue: w.role_name })}
                </div>
              </div>
              {w.id === workspace.id && <Check size={18} color="var(--primary)" />}
            </button>
          ))}
          <div className="divider" style={{ margin: '6px 0' }} />
          <button className="ws-item" onClick={() => { setOpen(false); nav('/workspaces'); }}>
            <div className="ws-dot tone-primary"><Plus size={16} /></div>
            <span className="small bold">{t('workspace.manage')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function useUnread() {
  const [n, setN] = useState(0);
  const loc = useLocation();
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/notifications').then((r) => alive && setN(r.unread)).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loc.pathname]);
  return n;
}

function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-ghost btn-icon" onClick={() => setOpen(!open)} aria-label="account">
        <Avatar name={user.full_name} size="sm" />
      </button>
      {open && (
        <div className="menu">
          <div style={{ padding: '8px 12px' }}>
            <div className="bold small">{user.full_name}</div>
            <div className="xs muted">{user.email}</div>
          </div>
          <div className="divider" style={{ margin: '4px 0' }} />
          <button onClick={() => { setOpen(false); nav('/settings'); }}><SettingsIcon size={17} /> {t('nav.settings')}</button>
          <button onClick={logout}><LogOut size={17} /> {t('auth.logout')}</button>
        </div>
      )}
    </div>
  );
}

function TeacherSidebar() {
  const { t } = useTranslation();
  const { can, workspace, isAdmin } = useAuth();
  const showOrg = workspace?.type === 'organization' && (can('member.manage') || can('report.view_org') || can('class.manage_all'));
  const L = ({ to, icon: Icon, label, end }) => (
    <NavLink to={to} end={end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
      <Icon size={19} /> {label}
    </NavLink>
  );
  const Sub = ({ to, label }) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
  );
  return (
    <aside className="sidebar">
      <div style={{ padding: '0 8px 14px' }}><Brand /></div>
      {workspace && (
        <>
          <L to="/" end icon={Home} label={t('nav.dashboard')} />
          <div className="side-group">
            <L to="/classes" icon={Users} label={t('nav.classes')} />
            <div className="side-sub">
              <Sub to="/classes" label={t('nav.classList')} />
              <Sub to="/students" label={t('nav.students')} />
            </div>
          </div>
          <L to="/teaching" icon={BookOpen} label={t('nav.teaching')} />
          <div className="side-group">
            <L to="/exams" icon={ClipboardList} label={t('nav.exercises')} />
            <div className="side-sub">
              <Sub to="/questions" label={t('nav.questionBank')} />
              <Sub to="/exams" label={t('nav.examBank')} />
              <Sub to="/assignments" label={t('nav.assigned')} />
              <Sub to="/grading" label={t('nav.toGrade')} />
            </div>
          </div>
          <L to="/reports" icon={ChartColumn} label={t('nav.reports')} />
          <L to="/notifications" icon={Bell} label={t('nav.interaction')} />
          <L to="/ai" icon={Sparkles} label={t('nav.ai')} />
          {showOrg && <L to="/org" icon={Building2} label={t('nav.org')} />}
        </>
      )}
      {isAdmin && (
        <>
          <div className="side-label">{t('nav.systemAdmin')}</div>
          <L to="/admin/users" icon={UsersRound} label={t('nav.users')} />
          <L to="/admin/system" icon={ShieldCheck} label={t('nav.system')} />
        </>
      )}
      <div style={{ marginTop: 'auto' }}>
        <L to="/workspaces" icon={Library} label={t('nav.workspaces')} />
        <L to="/settings" icon={SettingsIcon} label={t('nav.settings')} />
      </div>
    </aside>
  );
}

function StudentSidebar() {
  const { t } = useTranslation();
  const L = ({ to, icon: Icon, label, end }) => (
    <NavLink to={to} end={end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
      <Icon size={19} /> {label}
    </NavLink>
  );
  return (
    <aside className="sidebar">
      <div style={{ padding: '0 8px 14px' }}><Brand /></div>
      <L to="/s" end icon={ClipboardList} label={t('student.nav.assignments')} />
      <L to="/s/classes" icon={Users} label={t('student.nav.classes')} />
      <L to="/s/grades" icon={Star} label={t('student.nav.grades')} />
      <L to="/notifications" icon={Bell} label={t('nav.notifications')} />
      <div style={{ marginTop: 'auto' }}>
        <L to="/settings" icon={SettingsIcon} label={t('nav.settings')} />
      </div>
    </aside>
  );
}

function BottomNav({ items }) {
  return (
    <nav className="bottom-nav">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive || i.match?.() ? 'active' : '')}>
          <span className="nav-ic"><i.icon size={21} /></span>
          {i.label}
          {i.badge ? <span className="nav-badge">{i.badge > 99 ? '99+' : i.badge}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout({ student }) {
  const { t } = useTranslation();
  const { workspace, isAdmin } = useAuth();
  const unread = useUnread();
  const nav = useNavigate();
  const loc = useLocation();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  const starts = (...p) => () => p.some((x) => loc.pathname.startsWith(x));
  const teacherItems = workspace
    ? [
        { to: '/', end: true, icon: Home, label: t('nav.home') },
        { to: '/classes', icon: Users, label: t('nav.classes'), match: starts('/classes', '/students') },
        { to: '/assignments', icon: ClipboardList, label: t('nav.exercisesShort'), match: starts('/exams', '/questions', '/assignments') },
        { to: '/grading', icon: ClipboardCheck, label: t('nav.grading') },
        { to: '/more', icon: Grid2x2, label: t('nav.more'), match: starts('/more', '/reports', '/ai', '/org', '/teaching', '/settings', '/workspaces', '/admin') },
      ]
    : [
        ...(isAdmin ? [{ to: '/admin/users', icon: UsersRound, label: t('nav.users') }, { to: '/admin/system', icon: ShieldCheck, label: t('nav.system') }] : []),
        { to: '/workspaces', icon: Library, label: t('nav.workspaces') },
        { to: '/settings', icon: SettingsIcon, label: t('nav.settings') },
      ];
  const studentItems = [
    { to: '/s', end: true, icon: ClipboardList, label: t('student.nav.assignments'), match: starts('/s/assignments') },
    { to: '/s/classes', icon: Users, label: t('student.nav.classes') },
    { to: '/s/grades', icon: Star, label: t('student.nav.grades') },
    { to: '/notifications', icon: Bell, label: t('nav.notifications'), badge: unread },
    { to: '/settings', icon: User, label: t('nav.account') },
  ];

  return (
    <div className="app">
      {student ? <StudentSidebar /> : <TeacherSidebar />}
      <div className="main">
        <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          {student || !workspace ? (
            <div className="grow"><Brand /></div>
          ) : (
            <WorkspaceSwitcher />
          )}
          <button className="btn btn-ghost btn-icon" style={{ position: 'relative' }} onClick={() => nav('/notifications')} aria-label="notifications">
            <Bell size={21} />
            {unread > 0 && <span className="nav-badge" style={{ top: 2, left: 24 }}>{unread > 99 ? '99+' : unread}</span>}
          </button>
          <UserMenu />
        </header>
        <main className="content">
          <Outlet key={workspace?.id || 'none'} />
        </main>
      </div>
      <BottomNav items={student ? studentItems : teacherItems} />
    </div>
  );
}
