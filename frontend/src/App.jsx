import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Spinner } from './ui.jsx';
import AppLayout from './layout/AppLayout.jsx';
import { ConfirmPasswordChange, ForceChangePassword, ForgotPassword, Login, Register, ResetPassword, VerifyEmail } from './pages/Auth.jsx';
import Invite from './pages/Invite.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Classes from './pages/Classes.jsx';
import ClassDetail from './pages/class/ClassDetail.jsx';
import Students from './pages/Students.jsx';
import Materials from './pages/Materials.jsx';
import Questions from './pages/Questions.jsx';
import Exams from './pages/Exams.jsx';
import ExamBuilder from './pages/ExamBuilder.jsx';
import AIExamGenerator from './pages/AIExamGenerator.jsx';
import Assignments from './pages/Assignments.jsx';
import AssignmentDetail from './pages/AssignmentDetail.jsx';
import Grading from './pages/Grading.jsx';
import GradeSubmission from './pages/GradeSubmission.jsx';
import Reports from './pages/Reports.jsx';
import Notifications from './pages/Notifications.jsx';
import AIAssistant from './pages/AIAssistant.jsx';
import Org from './pages/Org.jsx';
import Workspaces from './pages/Workspaces.jsx';
import More from './pages/More.jsx';
import Settings from './pages/Settings.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';
import AdminSystem from './pages/admin/AdminSystem.jsx';
import StudentHome from './pages/student/StudentHome.jsx';
import StudentAssignment from './pages/student/StudentAssignment.jsx';
import StudentGrades from './pages/student/StudentGrades.jsx';
import StudentClasses from './pages/student/StudentClasses.jsx';

function RequireLogin() {
  const loc = useLocation();
  return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
}

// Các trang mở từ link trong email: dùng được cả khi chưa / đã đăng nhập
const EMAIL_ROUTES = (
  <>
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/confirm-password-change" element={<ConfirmPasswordChange />} />
  </>
);

export default function App() {
  const { loading, user, isStudent, isAdmin, workspace } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        {EMAIL_ROUTES}
        <Route path="*" element={<RequireLogin />} />
      </Routes>
    );
  }

  if (user.must_change_password) {
    return (
      <Routes>
        {EMAIL_ROUTES}
        <Route path="*" element={<ForceChangePassword />} />
      </Routes>
    );
  }

  if (isStudent) {
    return (
      <Routes>
        {EMAIL_ROUTES}
        <Route element={<AppLayout student />}>
          <Route path="/s" element={<StudentHome />} />
          <Route path="/s/assignments/:id" element={<StudentAssignment />} />
          <Route path="/s/grades" element={<StudentGrades />} />
          <Route path="/s/classes" element={<StudentClasses />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/s" replace />} />
      </Routes>
    );
  }

  const home = workspace ? '/' : isAdmin ? '/admin/users' : '/workspaces';
  return (
    <Routes>
      {EMAIL_ROUTES}
      <Route path="/login" element={<Navigate to={home} replace />} />
      <Route path="/register" element={<Navigate to={home} replace />} />
      <Route element={<AppLayout />}>
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/workspaces" element={<Workspaces />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/more" element={<More />} />
        {isAdmin && (
          <>
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/system" element={<AdminSystem />} />
          </>
        )}
        {workspace && (
          <>
            <Route path="/" element={<Dashboard />} />
            <Route path="/classes" element={<Classes />} />
            <Route path="/classes/:id" element={<ClassDetail />} />
            <Route path="/classes/:id/:tab" element={<ClassDetail />} />
            <Route path="/students" element={<Students />} />
            <Route path="/teaching" element={<Materials />} />
            <Route path="/questions" element={<Questions />} />
            <Route path="/exams" element={<Exams />} />
            <Route path="/exams/ai" element={<AIExamGenerator />} />
            <Route path="/exams/:id" element={<ExamBuilder />} />
            <Route path="/assignments" element={<Assignments />} />
            <Route path="/assignments/:id" element={<AssignmentDetail />} />
            <Route path="/grading" element={<Grading />} />
            <Route path="/grading/submissions/:id" element={<GradeSubmission />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/ai" element={<AIAssistant />} />
            <Route path="/org" element={<Org />} />
          </>
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
