/* Waraqa exam forms A/B/C — client-side only.
   No additional Gemini calls, no database changes, and no mutation of the saved exam.
   The source exam always remains the canonical editable copy. */
'use strict';

let waraqaSelectedForm = 'A';
const waraqaForms = ['A', 'B', 'C'];
const waraqaOriginalEditorHTML = editorHTML;
const waraqaOriginalPaperHTML = paperHTML;
const waraqaOriginalAct = act;

const waraqaOptionLetters = ['أ', 'ب', 'ج', 'د'];
function waraqaRotate(items, places) {
  const copy = items.slice();
  if (copy.length < 2) return copy;
  const offset = places % copy.length;
  return copy.slice(offset).concat(copy.slice(0, offset));
}
function waraqaNormalizeOption(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
    .replace(/[.،؛:!؟]+$/g, '').toLowerCase();
}
function waraqaAnswerIndex(question, options) {
  const answer = waraqaNormalizeOption(question.answer);
  const exact = options.findIndex(option => waraqaNormalizeOption(option) === answer);
  if (exact >= 0) return exact;
  // Only trust unambiguous letter-only keys: "ب", "B", "الإجابة الصحيحة: ج".
  const key = answer.match(/^(?:(?:الإجابة(?: الصحيحة)?|الاختيار(?: الصحيح)?)\s*[:：-]?\s*)?([أابجدa-d])\s*[).]?[\s]*$/i);
  if (!key) return -1;
  const letter = key[1];
  const index = /^[a-d]$/i.test(letter)
    ? letter.toLowerCase().charCodeAt(0) - 97
    : ['أ', 'ب', 'ج', 'د'].indexOf(letter === 'ا' ? 'أ' : letter);
  return index >= 0 && index < options.length ? index : -1;
}
function waraqaHasPositionDependentOption(question) {
  const text = [question.text, question.answer, ...(question.options || [])].join(' ');
  return /(كل\s+ما\s+سبق|جميع\s+ما\s+سبق|ليس\s+أي\s+مما\s+سبق|لا\s+شيء\s+مما\s+سبق|all\s+of\s+the\s+above|none\s+of\s+the\s+above|both\s+[a-d]\s+and\s+[a-d]|(?:الاختيار|الخيار|الإجابة)\s+(?:الأول|الثاني|الثالث|الرابع)|(?:[أبجد]\s*(?:و|أو)\s*[أبجد]))/i.test(text);
}
function waraqaTransformQuestion(question, shift) {
  const clone = { ...question };
  const options = Array.isArray(question.options) ? question.options.slice() : [];
  if (options.filter(Boolean).length < 2 || waraqaHasPositionDependentOption(question)) return clone;
  const correct = waraqaAnswerIndex(question, options);
  // If the answer isn't clearly linked to a choice, don't risk invalidating its key.
  if (correct < 0) return clone;
  const ordered = waraqaRotate(options, shift);
  const correctText = options[correct];
  const newIndex = ordered.indexOf(correctText);
  if (newIndex < 0) return clone;
  clone.options = ordered;
  clone.answer = (waraqaOptionLetters[newIndex] || String(newIndex + 1)) + ') ' + correctText;
  return clone;
}
function waraqaFormExam(exam, form) {
  if (!exam || form === 'A' || !waraqaForms.includes(form)) return exam;
  const shift = form === 'B' ? 1 : 2;
  const groups = new Map();
  for (const question of exam.questions) {
    const key = String(question.type || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(question);
  }
  const reordered = waraqaRotate([...groups.values()], shift)
    .flatMap(group => waraqaRotate(group, shift).map(q => waraqaTransformQuestion(q, shift)));
  return { ...exam, questions: reordered };
}
function waraqaFormPaper(exam, answerKey, form) {
  const safeForm = waraqaForms.includes(form) ? form : 'A';
  const html = waraqaOriginalPaperHTML(waraqaFormExam(exam, safeForm), answerKey);
  const badge = '<div class="waraqa-paper-form">' +
    (answerKey ? 'نموذج الإجابة — ' : 'نموذج الامتحان — ') + safeForm + '</div>';
  return html.replace('<div class="paper-mid">', '<div class="paper-mid">' + badge);
}
paperHTML = function(exam, answers = false, form = waraqaSelectedForm) {
  return waraqaFormPaper(exam, answers, form);
};

function waraqaFormPanel(exam) {
  if (!exam?.questions?.length) return '';
  const uncertain = exam.questions.filter(q =>
    Array.isArray(q.options) && q.options.filter(Boolean).length > 1 &&
    (waraqaAnswerIndex(q, q.options) < 0 || waraqaHasPositionDependentOption(q))
  ).length;
  return '<section class="form-card waraqa-forms-panel" aria-label="نماذج الامتحان">' +
    '<h3>📄 نماذج الامتحان A وB وC</h3>' +
    '<p class="mini-note">3 نماذج من نفس الأسئلة، بترتيبات مختلفة، من غير استخدام Gemini أو خصم أي توليد جديد. نسخة الأسئلة الأصلية لا تتغير.</p>' +
    '<div class="waraqa-form-buttons" role="group" aria-label="اختر نموذج الامتحان">' +
    waraqaForms.map(form =>
      '<button type="button" class="btn ' + (waraqaSelectedForm === form ? 'btn-primary waraqa-form-current' : 'btn-outline') +
      '" data-action="waraqa-form-select" data-form="' + form + '" aria-pressed="' +
      (waraqaSelectedForm === form ? 'true' : 'false') + '">نموذج ' + form + '</button>'
    ).join('') + '</div>' +
    '<div class="toolbar spaced"><button type="button" class="btn btn-outline btn-sm" data-action="waraqa-form-print-all">🖨️ طباعة النماذج الثلاثة</button>' +
    '<button type="button" class="btn btn-outline btn-sm" data-action="waraqa-form-keys-all">✅ طباعة إجابات النماذج الثلاثة</button></div>' +
    '<p class="mini-note spaced">الطباعة العادية ومعاينة الإجابات تعرض النموذج المحدد: <b>' + waraqaSelectedForm +
    '</b>. راجع الأسئلة المرتبطة ببعضها قبل توزيع النماذج.' +
    (uncertain ? ' • تم الاحتفاظ بترتيب اختيارات ' + uncertain +
      ' سؤال/أسئلة لأن مفتاح الإجابة غير واضح أو يعتمد على ترتيب الاختيارات.' : '') +
    '</p></section>';
}
editorHTML = function() {
  const html = waraqaOriginalEditorHTML();
  if (!state.exam?.questions?.length) return html;
  const panel = waraqaFormPanel(state.exam);
  const anchor = '<div class="notice blue">';
  return html.includes(anchor) ? html.replace(anchor, panel + anchor) : panel + html;
};

function waraqaPrintAllForms(includeAnswers) {
  if (!state.exam?.questions?.length) return toast('أضف أسئلة للامتحان أولًا');
  const root = document.querySelector('#print-root');
  if (!root) return;
  root.innerHTML = waraqaForms.map(form =>
    '<div class="waraqa-variant-sheet">' + paperHTML(state.exam, includeAnswers, form) + '</div>'
  ).join('');
  window.print();
}
act = async function(action, button) {
  if (action === 'waraqa-form-select') {
    const form = button?.dataset?.form;
    if (!waraqaForms.includes(form)) return;
    waraqaSelectedForm = form;
    render();
    return;
  }
  if (action === 'waraqa-form-print-all') return waraqaPrintAllForms(false);
  if (action === 'waraqa-form-keys-all') return waraqaPrintAllForms(true);
  if (['generate', 'generate-offline', 'ocr-generate', 'blank-exam', 'open-record', 'print-record'].includes(action)) {
    waraqaSelectedForm = 'A';
  }
  return waraqaOriginalAct(action, button);
};

// Only the print surface is visible to the browser printer. Each form starts
// on a new sheet; multi-page forms retain normal A4 pagination.
const waraqaFormStyle = document.createElement('style');
waraqaFormStyle.textContent = `
.waraqa-forms-panel{margin-bottom:18px;padding:18px 20px}
.waraqa-forms-panel h3{margin:0 0 8px;font-size:17px}
.waraqa-forms-panel .mini-note{line-height:1.6}
.waraqa-form-buttons{display:flex;flex-wrap:wrap;gap:9px;margin-top:13px}
.waraqa-form-buttons button{min-width:90px;flex:0 1 auto}
.waraqa-paper-form{font-size:14px;font-weight:800;color:#4338ac;margin-bottom:5px}
@media(max-width:620px){.waraqa-form-buttons button{flex:1;min-width:72px}.waraqa-forms-panel{padding:15px}}
@media print{
  .waraqa-variant-sheet{break-after:page;page-break-after:always}
  .waraqa-variant-sheet:last-child{break-after:auto;page-break-after:auto}
  .waraqa-paper-form{color:#000!important;font-size:14px}
}`;
document.head.appendChild(waraqaFormStyle);
