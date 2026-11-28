// Gửi email. MAIL_PROVIDER:
//   ses     → Amazon SES qua API (HTTPS 443). Khóa lấy từ AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
//   smtp    → máy chủ SMTP bất kỳ (nodemailer).
//   console → không gửi, in email ra log (chế độ dev).
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { query } from '../db/pool.js';

// Dựng thư MIME đầy đủ (HTML + text, tiêu đề tiếng Việt) bằng nodemailer, rồi gửi nguyên khối qua SES API.
function createSesTransport() {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  let clientPromise = null;
  const getClient = () => {
    clientPromise ??= import('@aws-sdk/client-sesv2').then(({ SESv2Client, SendEmailCommand }) => ({
      client: new SESv2Client({ region: config.mail.sesRegion }),
      SendEmailCommand,
    }));
    return clientPromise;
  };
  return {
    async sendMail(message) {
      const { client, SendEmailCommand } = await getClient();
      const { message: raw } = await composer.sendMail(message);
      const out = await client.send(new SendEmailCommand({
        Content: { Raw: { Data: raw } },
        ...(config.mail.sesConfigurationSet ? { ConfigurationSetName: config.mail.sesConfigurationSet } : {}),
      }));
      return { messageId: out.MessageId };
    },
  };
}

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (config.mail.provider === 'ses') {
    transport = createSesTransport();
  } else if (config.mail.provider === 'smtp') {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      tls: config.smtp.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
    });
  } else {
    transport = nodemailer.createTransport({ jsonTransport: true });
  }
  return transport;
}

export const mailConfigured = () => config.mail.provider !== 'console';

/** Mô tả ngắn cho trang quản trị, vd. "Amazon SES (ap-southeast-1)" */
export const mailProviderLabel = () =>
  config.mail.provider === 'ses' ? `Amazon SES (${config.mail.sesRegion})`
    : config.mail.provider === 'smtp' ? `SMTP ${config.smtp.host}:${config.smtp.port}`
      : null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout({ title, lines, button, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f6fb;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1c2033">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px">
    <div style="background:linear-gradient(135deg,#6d5dfc,#5b5bf6 45%,#22b8cf);border-radius:18px 18px 0 0;padding:20px 24px;color:#fff;font-weight:800;font-size:18px">🎓 Teacher Workspace</div>
    <div style="background:#fff;border-radius:0 0 18px 18px;padding:24px">
      <h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>
      ${lines.map((l) => `<p style="margin:0 0 12px;line-height:1.6">${esc(l)}</p>`).join('')}
      ${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="background:#5b5bf6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:700;display:inline-block">${esc(button.label)}</a></p>
      <p style="font-size:12px;color:#6b7186;word-break:break-all">${esc(button.url)}</p>` : ''}
      ${footer ? `<p style="font-size:13px;color:#6b7186;margin-top:20px">${esc(footer)}</p>` : ''}
    </div>
  </div></body></html>`;
}

const T = {
  vi: {
    verify_email: (d) => ({
      subject: 'Xác nhận địa chỉ email của bạn',
      title: `Chào ${d.name},`,
      lines: ['Cảm ơn bạn đã đăng ký Teacher Workspace. Vui lòng bấm nút bên dưới để xác nhận email và kích hoạt tài khoản.'],
      button: { label: 'Xác nhận email', url: d.url },
      footer: 'Liên kết có hiệu lực trong 48 giờ. Nếu bạn không đăng ký, hãy bỏ qua email này.',
    }),
    reset_password: (d) => ({
      subject: 'Đặt lại mật khẩu',
      title: `Chào ${d.name},`,
      lines: ['Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.'],
      button: { label: 'Đặt lại mật khẩu', url: d.url },
      footer: 'Liên kết có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu sẽ không thay đổi.',
    }),
    set_password: (d) => ({
      subject: 'Tài khoản Teacher Workspace của bạn đã được tạo',
      title: `Chào ${d.name},`,
      lines: [`Quản trị viên đã tạo cho bạn một tài khoản với email ${d.email}.`, 'Bấm nút bên dưới để đặt mật khẩu và bắt đầu sử dụng.'],
      button: { label: 'Đặt mật khẩu', url: d.url },
      footer: 'Liên kết có hiệu lực trong 7 ngày.',
    }),
    change_password: (d) => ({
      subject: 'Xác nhận đổi mật khẩu',
      title: `Chào ${d.name},`,
      lines: ['Bạn vừa yêu cầu đổi mật khẩu. Mật khẩu mới chỉ có hiệu lực sau khi bạn bấm xác nhận.'],
      button: { label: 'Xác nhận đổi mật khẩu', url: d.url },
      footer: 'Liên kết có hiệu lực trong 1 giờ. Nếu không phải bạn, hãy bỏ qua email này và đổi mật khẩu ngay.',
    }),
    password_changed: (d) => ({
      subject: 'Mật khẩu của bạn đã được thay đổi',
      title: `Chào ${d.name},`,
      lines: ['Mật khẩu tài khoản Teacher Workspace của bạn vừa được thay đổi. Tất cả phiên đăng nhập cũ đã bị đăng xuất.', 'Nếu không phải bạn thực hiện, hãy dùng chức năng "Quên mật khẩu" ngay hoặc liên hệ quản trị viên.'],
    }),
    workspace_invite: (d) => ({
      subject: `Lời mời tham gia ${d.workspace}`,
      title: 'Bạn có một lời mời mới',
      lines: [`${d.inviter} mời bạn tham gia "${d.workspace}" trên Teacher Workspace với vai trò ${d.role}.`, 'Nếu chưa có tài khoản, hãy đăng ký bằng chính email này rồi mở lại liên kết.'],
      button: { label: 'Xem lời mời', url: d.url },
    }),
    test: () => ({ subject: 'Email thử nghiệm', title: 'Cấu hình email hoạt động tốt 🎉', lines: ['Đây là email thử nghiệm gửi từ trang Quản trị hệ thống.'] }),
  },
  en: {
    verify_email: (d) => ({
      subject: 'Confirm your email address',
      title: `Hi ${d.name},`,
      lines: ['Thanks for signing up for Teacher Workspace. Please confirm your email to activate your account.'],
      button: { label: 'Confirm email', url: d.url },
      footer: 'This link expires in 48 hours. If you did not sign up, ignore this email.',
    }),
    reset_password: (d) => ({
      subject: 'Reset your password',
      title: `Hi ${d.name},`,
      lines: ['We received a request to reset the password of your account.'],
      button: { label: 'Reset password', url: d.url },
      footer: 'This link expires in 1 hour. If you did not request it, ignore this email.',
    }),
    set_password: (d) => ({
      subject: 'Your Teacher Workspace account is ready',
      title: `Hi ${d.name},`,
      lines: [`An administrator created an account for you (${d.email}).`, 'Click the button below to set your password.'],
      button: { label: 'Set password', url: d.url },
      footer: 'This link expires in 7 days.',
    }),
    change_password: (d) => ({
      subject: 'Confirm password change',
      title: `Hi ${d.name},`,
      lines: ['You requested a password change. The new password takes effect only after you confirm.'],
      button: { label: 'Confirm password change', url: d.url },
      footer: 'This link expires in 1 hour. If this was not you, ignore this email and change your password.',
    }),
    password_changed: (d) => ({
      subject: 'Your password was changed',
      title: `Hi ${d.name},`,
      lines: ['Your Teacher Workspace password was just changed and all other sessions were signed out.', 'If this was not you, use "Forgot password" immediately or contact your administrator.'],
    }),
    workspace_invite: (d) => ({
      subject: `Invitation to join ${d.workspace}`,
      title: 'You have a new invitation',
      lines: [`${d.inviter} invited you to join "${d.workspace}" on Teacher Workspace as ${d.role}.`, 'If you do not have an account yet, sign up with this email and open the link again.'],
      button: { label: 'View invitation', url: d.url },
    }),
    test: () => ({ subject: 'Test email', title: 'Email is configured correctly 🎉', lines: ['This is a test email sent from the System Admin page.'] }),
  },
};

/**
 * Gửi email theo mẫu. Không ném lỗi ra ngoài trừ khi `throwOnError` (lỗi được ghi vào email_logs).
 * @returns {Promise<boolean>} true nếu gửi (hoặc ghi log ở chế độ dev) thành công
 */
export async function sendMail({ to, template, locale = 'vi', data = {}, throwOnError = false }) {
  const tpl = (T[locale] || T.vi)[template](data);
  const html = layout(tpl);
  const text = [tpl.title, ...tpl.lines, tpl.button ? `${tpl.button.label}: ${tpl.button.url}` : '', tpl.footer || ''].filter(Boolean).join('\n\n');
  try {
    await getTransport().sendMail({
      from: config.smtp.from,
      to,
      subject: tpl.subject,
      html,
      text,
      ...(config.mail.replyTo ? { replyTo: config.mail.replyTo } : {}),
    });
    const status = mailConfigured() ? 'sent' : 'logged';
    if (!mailConfigured()) console.log(`\n📧 [DEV MAIL] To: ${to}\n   Subject: ${tpl.subject}\n   ${text.replace(/\n+/g, '\n   ')}\n`);
    await query('INSERT INTO email_logs(to_email, subject, template, status) VALUES ($1,$2,$3,$4)', [to, tpl.subject, template, status]).catch(() => {});
    return true;
  } catch (err) {
    console.error('[MAIL] failed:', err.message);
    await query('INSERT INTO email_logs(to_email, subject, template, status, error) VALUES ($1,$2,$3,$4,$5)', [to, tpl.subject, template, 'failed', String(err.message).slice(0, 500)]).catch(() => {});
    if (throwOnError) throw err;
    return false;
  }
}
