-- Teacher Workspace - schema khởi tạo (PostgreSQL 13+)
-- Nguyên tắc: mọi dữ liệu nghiệp vụ thuộc đúng MỘT workspace (cá nhân hoặc tổ chức).

-- ========== Tài khoản ==========
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  account_type  text NOT NULL DEFAULT 'teacher' CHECK (account_type IN ('teacher','student','parent')),
  locale        text NOT NULL DEFAULT 'vi',
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ========== Không gian làm việc ==========
CREATE TABLE workspaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL CHECK (type IN ('personal','organization')),
  name          text NOT NULL,
  org_kind      text CHECK (org_kind IN ('school','center')),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspaces_one_personal ON workspaces(owner_user_id) WHERE type = 'personal';

-- ========== Phân quyền (RBAC + phạm vi dữ liệu) ==========
CREATE TABLE permissions (
  key         text PRIMARY KEY,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL = vai trò hệ thống
  key          text NOT NULL,
  name         text NOT NULL,
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX roles_system_key ON roles(key) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX roles_ws_key ON roles(workspace_id, key) WHERE workspace_id IS NOT NULL;

CREATE TABLE role_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE workspace_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES roles(id),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  invited_email text,
  invite_token  text UNIQUE,
  invited_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  joined_at     timestamptz
);
CREATE UNIQUE INDEX wm_ws_user ON workspace_members(workspace_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX wm_user ON workspace_members(user_id);
CREATE INDEX wm_invited_email ON workspace_members(lower(invited_email)) WHERE status = 'invited';

-- ========== File ==========
CREATE TABLE file_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by   uuid REFERENCES users(id),
  storage_path  text NOT NULL,
  original_name text,
  mime_type     text,
  size_bytes    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ========== Lớp học & học sinh ==========
CREATE TABLE classes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  subject      text,
  grade_level  text,
  school_year  text,
  description  text,
  color        text,
  join_code    text NOT NULL UNIQUE,
  archived     boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classes_ws ON classes(workspace_id);

CREATE TABLE class_teachers (
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     text NOT NULL DEFAULT 'main' CHECK (role IN ('main','assistant')),
  PRIMARY KEY (class_id, user_id)
);

-- Học sinh KHÁC tài khoản đăng nhập: user_id có thể NULL (HS nhỏ tuổi chưa có tài khoản)
CREATE TABLE students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  student_code   text NOT NULL,
  full_name      text NOT NULL,
  dob            date,
  gender         text CHECK (gender IN ('male','female','other')),
  guardian_name  text,
  guardian_phone text,
  guardian_email text,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, student_code)
);
CREATE INDEX students_user ON students(user_id);

CREATE TABLE class_enrollments (
  class_id    uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX enroll_student ON class_enrollments(student_id);

CREATE TABLE attendance_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date        date NOT NULL,
  status      text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note        text,
  recorded_by uuid REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, student_id, date)
);

-- ========== Học liệu ==========
CREATE TABLE materials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  class_id     uuid REFERENCES classes(id) ON DELETE SET NULL,
  title        text NOT NULL,
  type         text NOT NULL CHECK (type IN ('note','link','file','lesson_plan')),
  content      text,
  url          text,
  file_id      uuid REFERENCES file_assets(id) ON DELETE SET NULL,
  source_id    uuid,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX materials_ws ON materials(workspace_id);

-- ========== Ngân hàng câu hỏi (có phiên bản) ==========
CREATE TABLE questions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('single_choice','multiple_choice','true_false','short_answer','essay')),
  subject            text,
  grade_level        text,
  topic              text,
  difficulty         text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  tags               text[] NOT NULL DEFAULT '{}',
  current_version    integer NOT NULL DEFAULT 1,
  archived           boolean NOT NULL DEFAULT false,
  source_question_id uuid,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX questions_ws ON questions(workspace_id);

CREATE TABLE question_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id    uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version        integer NOT NULL,
  content        text NOT NULL,
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id:'A', text:'...'}]
  correct_answer jsonb,                                -- 'A' | ['A','C'] | true | ['đáp án 1', ...]
  explanation    text,
  rubric         text,                                 -- hướng dẫn chấm cho tự luận
  default_points numeric(6,2) NOT NULL DEFAULT 1,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, version)
);

-- ========== Đề thi / bài tập ==========
CREATE TABLE exams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title             text NOT NULL,
  subject           text,
  grade_level       text,
  kind              text NOT NULL DEFAULT 'exercise' CHECK (kind IN ('exercise','test')),
  description       text,
  duration_minutes  integer,
  shuffle_questions boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','published','archived')),
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  source_exam_id    uuid,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX exams_ws ON exams(workspace_id);

-- Đề trỏ tới PHIÊN BẢN câu hỏi => sửa câu hỏi không làm sai lệch bài đã nộp
CREATE TABLE exam_questions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id             uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_version_id uuid NOT NULL REFERENCES question_versions(id),
  position            integer NOT NULL,
  points              numeric(6,2) NOT NULL DEFAULT 1
);
CREATE INDEX exam_questions_exam ON exam_questions(exam_id);

-- ========== Giao bài & nộp bài ==========
CREATE TABLE assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  exam_id      uuid NOT NULL REFERENCES exams(id),
  class_id     uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title        text NOT NULL,
  instructions text,
  mode         text NOT NULL DEFAULT 'online' CHECK (mode IN ('online','paper')),
  start_at     timestamptz,
  due_at       timestamptz,
  allow_late   boolean NOT NULL DEFAULT true,
  show_result  text NOT NULL DEFAULT 'after_grading' CHECK (show_result IN ('immediately','after_grading')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignments_class ON assignments(class_id);
CREATE INDEX assignments_ws ON assignments(workspace_id);

CREATE TABLE submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress','submitted','ai_processing','ai_suggested','graded')),
  answers         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { exam_question_id: answer }
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{file_id, url, name}]
  started_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  is_late         boolean NOT NULL DEFAULT false,
  graded_at       timestamptz,
  graded_by       uuid REFERENCES users(id),
  auto_score      numeric(6,2),
  final_score     numeric(6,2),
  max_score       numeric(6,2),
  teacher_comment text,
  ai_error        text,
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX submissions_status ON submissions(assignment_id, status);

-- Lịch sử chấm: tách điểm tự động / AI đề xuất / giáo viên duyệt
CREATE TABLE grading_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id    uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  exam_question_id uuid NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('auto','ai','teacher')),
  score            numeric(6,2),
  max_score        numeric(6,2),
  feedback         text,
  details          jsonb,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grading_results_sub ON grading_results(submission_id, exam_question_id, created_at DESC);

-- ========== Sổ điểm ==========
CREATE TABLE grade_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'other'
                CHECK (category IN ('oral','quiz','test','midterm','final','assignment','other')),
  weight        numeric(4,2) NOT NULL DEFAULT 1,
  max_score     numeric(6,2) NOT NULL DEFAULT 10,
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  term          text,
  locked        boolean NOT NULL DEFAULT false,
  locked_by     uuid REFERENCES users(id),
  locked_at     timestamptz,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grade_items_class ON grade_items(class_id);

CREATE TABLE grades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_item_id uuid NOT NULL REFERENCES grade_items(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score         numeric(6,2),
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','assignment')),
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grade_item_id, student_id)
);

CREATE TABLE grade_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade_id   uuid NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  old_score  numeric(6,2),
  new_score  numeric(6,2),
  reason     text,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- ========== Hệ thống ==========
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  type         text NOT NULL,
  title        text NOT NULL,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  workspace_id uuid,
  user_id      uuid,
  action       text NOT NULL,
  entity       text,
  entity_id    uuid,
  data         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_ws ON audit_logs(workspace_id, created_at DESC);
