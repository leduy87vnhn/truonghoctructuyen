// Nguồn duy nhất định nghĩa quyền và vai trò hệ thống.
// Quyền được kiểm tra theo KEY (không hard-code theo tên vai trò),
// kết hợp với phạm vi dữ liệu (vd: giáo viên chỉ sửa điểm lớp mình được phân công).

export const PERMISSIONS = {
  'workspace.manage': 'Cấu hình không gian / tổ chức',
  'member.manage': 'Mời thành viên, phân quyền',
  'class.create': 'Tạo lớp học',
  'class.view_all': 'Xem tất cả lớp trong không gian',
  'class.manage_all': 'Quản lý mọi lớp, phân công giáo viên',
  'student.manage': 'Quản lý hồ sơ học sinh',
  'student.export': 'Xuất dữ liệu học sinh',
  'attendance.manage': 'Điểm danh',
  'material.manage': 'Quản lý học liệu, giáo án',
  'question.manage': 'Quản lý ngân hàng câu hỏi',
  'exam.manage': 'Tạo và sửa đề',
  'exam.approve': 'Duyệt đề thi',
  'assignment.manage': 'Giao bài',
  'grade.update': 'Chấm bài, nhập điểm',
  'grade.lock': 'Khóa / mở khóa điểm',
  'report.view': 'Xem báo cáo lớp',
  'report.view_org': 'Xem báo cáo toàn tổ chức',
  'ai.use': 'Sử dụng trợ lý AI',
  'content.share': 'Sao chép học liệu vào không gian khác',
  'portal.student': 'Cổng học sinh',
  'portal.parent': 'Cổng phụ huynh',
};

const ALL_STAFF = Object.keys(PERMISSIONS).filter((p) => !p.startsWith('portal.'));

export const SYSTEM_ROLES = {
  owner: { name: 'Chủ sở hữu', permissions: ALL_STAFF },
  org_admin: { name: 'Quản trị tổ chức', permissions: ALL_STAFF },
  academic_manager: {
    name: 'Quản lý học vụ / Tổ trưởng',
    permissions: [
      'class.create', 'class.view_all', 'class.manage_all', 'student.manage', 'student.export',
      'attendance.manage', 'material.manage', 'question.manage', 'exam.manage', 'exam.approve',
      'assignment.manage', 'grade.update', 'grade.lock', 'report.view', 'report.view_org', 'ai.use',
      'content.share',
    ],
  },
  teacher: {
    name: 'Giáo viên',
    permissions: [
      'student.manage', 'attendance.manage', 'material.manage', 'question.manage', 'exam.manage',
      'assignment.manage', 'grade.update', 'report.view', 'ai.use', 'content.share',
    ],
  },
  assistant: {
    name: 'Trợ giảng',
    permissions: ['attendance.manage', 'grade.update', 'report.view'],
  },
  student: { name: 'Học sinh', permissions: ['portal.student'] },
  parent: { name: 'Phụ huynh', permissions: ['portal.parent'] },
};

// Vai trò có thể mời vào tổ chức (không cho mời 'owner')
export const INVITABLE_ROLES = ['org_admin', 'academic_manager', 'teacher', 'assistant'];
