// Tầng AI độc lập: các module nghiệp vụ chỉ gọi các hàm ở đây,
// nên có thể đổi nhà cung cấp (OpenAI -> khác) mà không sửa nghiệp vụ.
// AI chỉ ĐỀ XUẤT; giáo viên luôn là người duyệt điểm chính thức.
import OpenAI from 'openai';
import { config } from '../config.js';
import { HttpError } from './http.js';
import { round2 } from './util.js';

let client = null;
function getClient() {
  if (!config.openai.apiKey) throw new HttpError(503, 'AI_DISABLED', 'OPENAI_API_KEY is not configured');
  if (!client) client = new OpenAI({ apiKey: config.openai.apiKey, baseURL: config.openai.baseURL });
  return client;
}

export const aiEnabled = () => Boolean(config.openai.apiKey);

const langName = (locale) => (locale === 'en' ? 'English' : 'Vietnamese (tiếng Việt)');

async function chatJson(messages, { temperature = 0.2 } = {}) {
  try {
    const res = await getClient().chat.completions.create({
      model: config.openai.model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    });
    return JSON.parse(res.choices[0]?.message?.content || '{}');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[AI] error:', err?.message);
    throw new HttpError(502, 'AI_FAILED', err?.message || 'AI request failed');
  }
}

function describeQuestion(q, idx) {
  const lines = [`### Question ${idx + 1} (id: ${q.id}, type: ${q.type}, max points: ${q.points})`, q.content];
  if (Array.isArray(q.options) && q.options.length) {
    lines.push('Options:', ...q.options.map((o) => `${o.id}. ${o.text}`));
  }
  if (q.correct_answer !== null && q.correct_answer !== undefined) {
    lines.push(`Answer key: ${JSON.stringify(q.correct_answer)}`);
  }
  if (q.rubric) lines.push(`Grading rubric: ${q.rubric}`);
  if (q.answerText !== undefined) {
    lines.push(`Student typed answer: ${q.answerText === '' || q.answerText == null ? '(empty)' : JSON.stringify(q.answerText)}`);
  }
  return lines.join('\n');
}

/**
 * Chấm/gợi ý điểm cho các câu hỏi. Có thể kèm ảnh bài làm (bài giấy / ảnh chụp lời giải).
 * @param {{items: Array, images?: string[], locale?: string, subject?: string}} p
 * @returns {Promise<Array<{id, score, feedback, extracted_answer, confidence}>>}
 */
export async function gradeAnswers({ items, images = [], locale = 'vi', subject }) {
  const system = `You are an experienced, fair teacher's grading assistant${subject ? ` for the subject "${subject}"` : ''}.
Grade each question strictly according to the answer key and rubric. Award partial credit when appropriate (multiples of 0.25).
If images of handwritten or printed student work are attached, first read (OCR) the student's answer for each question from the images, including math notation.
Never exceed the max points of a question. If an answer cannot be found or read, give 0 and say so.
Write feedback for the student in ${langName(locale)}: short, encouraging, pointing out the specific mistake.
Return JSON: {"results":[{"id":"<question id>","extracted_answer":"<what the student answered, as read>","score":<number>,"feedback":"<text>","confidence":<0..1>}]}`;

  const text = items.map(describeQuestion).join('\n\n');
  const content = [{ type: 'text', text: `Grade the following questions:\n\n${text}` }];
  for (const url of images) content.push({ type: 'image_url', image_url: { url, detail: 'high' } });

  const data = await chatJson([
    { role: 'system', content: system },
    { role: 'user', content },
  ]);
  const byId = new Map(items.map((q) => [q.id, q]));
  return (data.results || [])
    .filter((r) => byId.has(r.id))
    .map((r) => {
      const max = Number(byId.get(r.id).points);
      const score = Math.min(max, Math.max(0, round2(Number(r.score) || 0)));
      return {
        id: r.id,
        score,
        feedback: String(r.feedback || ''),
        extracted_answer: r.extracted_answer ?? null,
        confidence: typeof r.confidence === 'number' ? r.confidence : null,
      };
    });
}

const TYPE_SPEC = {
  single_choice: 'single correct choice; 4 options with ids A-D; correct_answer is one id string, e.g. "B"',
  multiple_choice: 'multiple correct choices; 4-5 options with ids A-E; correct_answer is an array of ids, e.g. ["A","C"]',
  true_false: 'true/false statement; options empty; correct_answer is boolean true or false',
  short_answer: 'short answer (a number or a few words); options empty; correct_answer is an array of accepted answers',
  essay: 'open-ended / essay / step-by-step problem; options empty; correct_answer null; include a detailed rubric with point breakdown',
};

/** Sinh câu hỏi bằng AI (trả về bản nháp, giáo viên duyệt trước khi lưu). */
export async function generateQuestions({ subject, gradeLevel, topic, type, count, difficulty, notes, locale = 'vi' }) {
  const system = `You create high-quality assessment questions for school teachers. Content must be accurate and age-appropriate.
Write all question content, options, explanation and rubric in ${langName(locale)}. Use plain text; for math you may use simple notation like x^2, sqrt(x), a/b.
Return JSON: {"questions":[{"type":"${type}","content":"...","options":[{"id":"A","text":"..."}],"correct_answer":...,"explanation":"...","rubric":"...","difficulty":"easy|medium|hard","points":<number>}]}`;
  const user = `Create ${count} questions.
Subject: ${subject || 'any'}
Grade level: ${gradeLevel || 'any'}
Topic: ${topic}
Difficulty: ${difficulty || 'mixed'}
Question type: ${type} — ${TYPE_SPEC[type]}
${notes ? `Additional requirements: ${notes}` : ''}`;
  const data = await chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.7 },
  );
  return (data.questions || []).slice(0, count).map((q) => normalizeQuestion(q, type, difficulty));
}

/** Chuẩn hóa câu hỏi AI trả về để khớp định dạng của ngân hàng câu hỏi. */
function normalizeQuestion(q, type, difficulty, points) {
  const options = ['single_choice', 'multiple_choice'].includes(type) && Array.isArray(q.options)
    ? q.options.map((o, i) => ({ id: String.fromCharCode(65 + i), text: String(o?.text ?? o ?? ''), _oldId: String(o?.id ?? '') }))
    : [];
  // AI đôi khi đánh id khác A-D: ánh xạ lại đáp án theo id mới
  const remap = (v) => {
    const hit = options.find((o) => o._oldId && o._oldId === String(v));
    return hit ? hit.id : String(v);
  };
  let correct = q.correct_answer ?? null;
  if (type === 'single_choice') correct = remap(Array.isArray(correct) ? correct[0] : correct);
  if (type === 'multiple_choice') correct = (Array.isArray(correct) ? correct : [correct]).filter((x) => x != null).map(remap);
  if (type === 'true_false') correct = correct === true || String(correct).toLowerCase() === 'true' || correct === 'Đúng';
  if (type === 'short_answer') correct = (Array.isArray(correct) ? correct : [correct]).filter((x) => x != null && String(x).trim()).map(String);
  if (type === 'essay') correct = null;
  return {
    type,
    content: String(q.content || ''),
    options: options.map(({ _oldId, ...o }) => o),
    correct_answer: correct,
    explanation: q.explanation || '',
    rubric: q.rubric || '',
    difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
    points: points ?? (Number(q.points) > 0 ? Number(q.points) : 1),
  };
}

/**
 * Tạo nguyên một đề theo cơ cấu (ma trận) do giáo viên chọn.
 * sections: [{ type, count, points }] — points là điểm cho MỖI câu của phần đó.
 * sourceText: (tùy chọn) nội dung bài học / tài liệu để AI ra đề bám sát.
 */
export async function generateExam({ title, subject, gradeLevel, topic, sections, difficulty, notes, sourceText, locale = 'vi' }) {
  const total = sections.reduce((s, x) => s + x.count, 0);
  const system = `You are an expert teacher who designs well-balanced tests and exercises for school students.
Questions must be accurate, unambiguous, age-appropriate, cover different aspects of the topic, and must not repeat each other.
Write everything (content, options, explanation, rubric) in ${langName(locale)}. Plain text only; for math use simple notation like x^2, sqrt(x), a/b.
For each question also give a short "explanation" of the correct answer. For essay questions give a "rubric" with a point breakdown that sums to the question's points.
Return JSON: {"sections":[{"type":"<type>","questions":[{"content":"...","options":[{"id":"A","text":"..."}],"correct_answer":...,"explanation":"...","rubric":"...","difficulty":"easy|medium|hard"}]}]}`;
  const user = `Create a ${total}-question ${title ? `exam titled "${title}"` : 'exam'}.
Subject: ${subject || 'any'}
Grade level: ${gradeLevel || 'any'}
Topic / scope: ${topic}
Overall difficulty: ${difficulty || 'mixed (about 40% easy, 40% medium, 20% hard)'}
${notes ? `Additional requirements: ${notes}\n` : ''}Sections (keep this exact order and exact question counts):
${sections.map((s, i) => `${i + 1}. type "${s.type}" — ${s.count} questions, ${s.points} point(s) each — ${TYPE_SPEC[s.type]}`).join('\n')}
${sourceText ? `\nBase the questions strictly on this source material:\n"""\n${sourceText.slice(0, 15000)}\n"""` : ''}`;
  const data = await chatJson(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.6 },
  );
  const out = [];
  sections.forEach((s, i) => {
    // Ưu tiên khớp theo thứ tự phần; dự phòng theo loại câu hỏi
    const sec = data.sections?.[i]?.type === s.type ? data.sections[i] : data.sections?.find((x) => x.type === s.type) || data.sections?.[i];
    for (const q of (sec?.questions || []).slice(0, s.count)) {
      const n = normalizeQuestion(q, s.type, difficulty, s.points);
      if (n.content) out.push(n);
    }
  });
  return out;
}

const ASSISTANT_MODES = {
  lesson_plan: 'Help the teacher design a lesson plan: objectives, preparation, activities with timing, assessment and homework. Use Markdown headings and lists.',
  remedial: 'Analyze the class results provided, identify the most common misconceptions and weak topics, and propose a concrete remedial plan with example exercises. Use Markdown.',
  feedback: 'Help the teacher write constructive, kind feedback/comments for students or parents. Use Markdown.',
  free: 'Answer the teacher\'s question helpfully and concisely. Use Markdown.',
};

/** Trợ lý AI dạng hỏi-đáp cho giáo viên. Trả về Markdown. */
export async function teacherAssistant({ mode = 'free', prompt, context, locale = 'vi' }) {
  const system = `You are "Trợ lý AI", a supportive teaching assistant inside the Teacher Workspace app. ${ASSISTANT_MODES[mode] || ASSISTANT_MODES.free}
Always answer in ${langName(locale)}. Return JSON: {"answer":"<markdown>"}`;
  const messages = [{ role: 'system', content: system }];
  if (context) messages.push({ role: 'user', content: `Context data:\n${context}` });
  messages.push({ role: 'user', content: prompt });
  const data = await chatJson(messages, { temperature: 0.6 });
  return String(data.answer || '');
}
