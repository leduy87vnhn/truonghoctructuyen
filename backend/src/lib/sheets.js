import ExcelJS from 'exceljs';

const stripVN = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const HEADER_MAP = [
  ['full_name', ['ho ten', 'ho va ten', 'ten hoc sinh', 'ten', 'full name', 'name', 'student name']],
  ['student_code', ['ma hs', 'ma hoc sinh', 'ma', 'student code', 'code', 'id']],
  ['dob', ['ngay sinh', 'dob', 'birthday', 'date of birth']],
  ['gender', ['gioi tinh', 'gender', 'sex']],
  ['guardian_name', ['phu huynh', 'ten phu huynh', 'ho ten phu huynh', 'guardian', 'parent', 'parent name']],
  ['guardian_phone', ['sdt phu huynh', 'so dien thoai', 'dien thoai', 'sdt', 'phone', 'parent phone']],
  ['guardian_email', ['email phu huynh', 'email', 'parent email']],
  ['note', ['ghi chu', 'note', 'notes']],
];

function mapHeader(h) {
  const n = stripVN(h);
  for (const [field, names] of HEADER_MAP) if (names.includes(n)) return field;
  return null;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function parseGender(v) {
  const s = stripVN(v);
  if (['nam', 'male', 'm', 'trai'].includes(s)) return 'male';
  if (['nu', 'female', 'f', 'gai'].includes(s)) return 'female';
  return s ? 'other' : null;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v.richText) return v.richText.map((r) => r.text).join('');
  }
  return String(v);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const delim = text.split('\n')[0].includes(';') && !text.split('\n')[0].includes(',') ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Đọc danh sách học sinh từ file .xlsx hoặc .csv. Trả về [{full_name, student_code, ...}] */
export async function parseStudentSheet(file) {
  let table;
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.csv')) {
    table = parseCsv(file.buffer.toString('utf8').replace(/^﻿/, ''));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets[0];
    table = [];
    ws?.eachRow({ includeEmpty: false }, (r) => {
      const vals = [];
      r.eachCell({ includeEmpty: true }, (c, col) => { vals[col - 1] = cellText(c.value); });
      table.push(vals);
    });
  }
  // Tìm dòng tiêu đề trong 5 dòng đầu
  let headerIdx = -1;
  let fields = [];
  for (let i = 0; i < Math.min(5, table.length); i++) {
    const f = (table[i] || []).map((h) => (h instanceof Date ? null : mapHeader(h)));
    if (f.includes('full_name')) { headerIdx = i; fields = f; break; }
  }
  if (headerIdx < 0) return { rows: [], error: 'HEADER_NOT_FOUND' };
  const rows = [];
  for (const raw of table.slice(headerIdx + 1)) {
    const r = {};
    fields.forEach((f, i) => { if (f) r[f] = raw?.[i]; });
    const full_name = String(r.full_name ?? '').trim();
    if (!full_name) continue;
    rows.push({
      full_name,
      student_code: String(r.student_code ?? '').trim() || null,
      dob: parseDate(r.dob),
      gender: parseGender(r.gender),
      guardian_name: String(r.guardian_name ?? '').trim() || null,
      guardian_phone: String(r.guardian_phone ?? '').trim() || null,
      guardian_email: String(r.guardian_email ?? '').trim() || null,
      note: String(r.note ?? '').trim() || null,
    });
  }
  return { rows };
}

export async function studentTemplateBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoc sinh');
  ws.columns = [
    { header: 'Họ tên', width: 28 },
    { header: 'Mã HS', width: 12 },
    { header: 'Ngày sinh', width: 14 },
    { header: 'Giới tính', width: 10 },
    { header: 'Phụ huynh', width: 24 },
    { header: 'SĐT phụ huynh', width: 16 },
    { header: 'Email phụ huynh', width: 26 },
    { header: 'Ghi chú', width: 24 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow(['Nguyễn Minh Anh', 'HS001', '15/03/2013', 'Nữ', 'Nguyễn Văn Hùng', '0901234567', '', '']);
  return wb.xlsx.writeBuffer();
}

export { ExcelJS };
