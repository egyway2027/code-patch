/**
 * Code Auditor v6
 *
 * Conservative, informational post-patch audit. It never executes user code.
 *
 * Design note (why this replaces a text/regex scanner):
 * A whole-text regex scan (e.g. `/\beval\s*\(/`) matches the string "eval(" no matter
 * where it appears — inside a comment, inside an unrelated string literal, inside a
 * variable named `retrieval(...)`. That produces false positives on code that is 100%
 * safe, and a false positive that *blocks a commit* is exactly the kind of silent,
 * unjustified failure this whole tool exists to prevent.
 *
 * This auditor instead walks the real AST (the same one produced by @babel/parser for
 * validation — see parseJsAst in patchEngine.js) and only flags a *structural* match:
 * an actual CallExpression whose callee is the identifier `eval`, an actual assignment
 * to a `.innerHTML` property, an actual JSXAttribute named `dangerouslySetInnerHTML`,
 * and so on. A string literal that merely contains the text "eval(" is a StringLiteral
 * node, not a CallExpression, and is never visited as one.
 *
 * Every finding here is a *warning*, not a certainty — naming a variable `apiKey` and
 * giving it a string value doesn't prove it's a live secret. Findings never block a
 * commit on their own. The optional `strict` flag lets the caller (the UI, on explicit
 * user opt-in) turn "critical" findings into a hard gate; the default is report-only.
 */
import { JS_LIKE, parseJsAst, summarizeChanges } from "./patchEngine.js";

export const AUDITOR_VERSION = "11.0.0";
const MAX_FINDINGS = 300;

function lineOf(text, index) {
  return String(text ?? "").slice(0, Math.max(0, index)).split(/\r\n|\r|\n/).length;
}

// Generic structural walk over a Babel AST: recurses into any own property that looks
// like a node (has a string `.type`) or an array of such, skipping position bookkeeping
// and comment fields. This intentionally avoids adding @babel/traverse as a dependency —
// the tool already ships @babel/parser for validation and this reuses that AST as-is.
function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  if (Array.isArray(node)) { for (const item of node) walk(item, visit, seen); return; }
  if (typeof node.type !== "string") return;
  seen.add(node);
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range" ||
        key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const value = node[key];
    if (value && typeof value === "object") walk(value, visit, seen);
  }
}

const PLACEHOLDER_VALUE = /\b(test|example|sample|dummy|fake|placeholder|changeme|xxxx|your[_-]?key|not[_-]?real)\b/i;
const SECRET_KEY_NAME = /^(password|passwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token)$/i;
const SQL_KEYWORD = /\b(select|insert|update|delete)\b/i;
const COMMAND_EXEC_NAMES = new Set(["exec", "execSync", "spawn", "spawnSync"]);
const FS_DESTRUCTIVE_NAMES = new Set(["rmSync", "unlinkSync", "rmdirSync"]);



// V11 non-JS security layer. It is deliberately lexical/conservative: comments and
// quoted literals are masked before rules run, so a string containing "eval(" does not
// become a finding. These rules are advisory except for explicitly marked critical rules.
function maskNonCode(source, language) {
  let s = String(source ?? "");
  // Preserve newlines so reported locations stay stable.
  s = s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
  s = s.replace(/\/\/[^\n\r]*/g, m => " ".repeat(m.length));
  if (language === "python") s = s.replace(/(^|\n)\s*#[^\n\r]*/g, m => m.replace(/[^\n]/g, " "));
  // Mask common quoted strings; keep the quote-free structure and line count.
  s = s.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, m => m.replace(/[^\n]/g, " "));
  return s;
}

function scanNonJsSecurity(source, language) {
  const s = maskNonCode(source, language);
  const rules = [];
  if (language === "python") {
    rules.push([/\beval\s*\(/g, "PY-EVAL", "critical", "high", "Python eval() فعلي: تنفيذ تعبير ديناميكي."]);
    rules.push([/\bexec\s*\(/g, "PY-EXEC", "critical", "high", "Python exec() فعلي: تنفيذ كود ديناميكي."]);
    rules.push([/\bos\.system\s*\(|\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\(/g, "PY-COMMAND", "high", "high", "استدعاء تنفيذ أمر نظام في Python."]);
    rules.push([/\bshell\s*=\s*True\b/g, "PY-SHELL-TRUE", "high", "high", "subprocess مع shell=True يرفع خطر command injection."]);
    rules.push([/\bpickle\.(?:load|loads)\s*\(/g, "PY-PICKLE", "high", "medium", "فك pickle من مصدر غير موثوق قد يؤدي إلى تنفيذ كود."]);
  } else if (language === "java") {
    rules.push([/\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(/g, "JAVA-RUNTIME-EXEC", "high", "high", "Java Runtime.exec() ينفذ أمر نظام."]);
    rules.push([/\bnew\s+ProcessBuilder\s*\(/g, "JAVA-PROCESSBUILDER", "high", "high", "ProcessBuilder ينشئ عملية نظام."]);
    rules.push([/\bObjectInputStream\s*\(/g, "JAVA-DESERIALIZE", "high", "medium", "Java ObjectInputStream يحتاج تحققًا صارمًا من مصدر البيانات."]);
  } else if (language === "c" || language === "cpp") {
    rules.push([/\b(?:system|popen)\s*\(/g, "C-COMMAND", "high", "high", "C/C++ system()/popen() ينفذ أوامر نظام."]);
    rules.push([/\b(?:strcpy|strcat|sprintf|gets)\s*\(/g, "C-UNSAFE-API", "high", "high", "استخدام API غير آمن قد يسبب buffer overflow."]);
    rules.push([/\b(?:memcpy|memmove)\s*\(/g, "C-MEMORY-API", "warning", "medium", "استدعاء memory API حساس؛ تحقق من حدود المصدر والوجهة."]);
  } else if (language === "go") {
    rules.push([/\bexec\s*\.\s*Command(?:Context)?\s*\(/g, "GO-COMMAND", "high", "high", "os/exec Command ينفذ عملية نظام."]);
    rules.push([/\b(?:os\.)?(?:Remove|RemoveAll)\s*\(/g, "GO-FS-DESTRUCTIVE", "high", "high", "حذف ملفات/مجلدات في Go."]);
    rules.push([/\b(?:gob|yaml|json)\.(?:NewDecoder|Unmarshal)\s*\(/g, "GO-DESERIALIZE", "warning", "medium", "فك/تحليل بيانات خارجية؛ تحقق من الحدود والتحقق من المدخلات."]);
  }
  const findings=[];
  for (const [re, code, severity, confidence, message] of rules) {
    for (const m of s.matchAll(re)) {
      findings.push({ code, severity, confidence, message, line: lineOf(source, m.index) });
      if (findings.length >= MAX_FINDINGS) return findings;
    }
  }
  return findings;
}

function calleeName(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.property?.type === "Identifier") return node.property.name;
  return null;
}

/** AST-based security scan. Every finding is structural (a real node shape), never a text match. */
function scanAst(ast, source) {
  const findings = [];
  const push = (node, f) => { if (findings.length < MAX_FINDINGS) findings.push({ ...f, line: lineOf(source, node.start) }); };

  walk(ast.program, (node) => {
    if (node.type === "CallExpression") {
      const name = calleeName(node.callee);
      if (node.callee.type === "Identifier" && node.callee.name === "eval") {
        push(node, { code: "JS-EVAL", severity: "critical", confidence: "certain", message: "استدعاء eval() فعلي: تنفيذ كود ديناميكي غير موثوق." });
      } else if (name && COMMAND_EXEC_NAMES.has(name)) {
        push(node, { code: "NODE-COMMAND", severity: "high", confidence: "high", message: `استدعاء ${name}(): تنفيذ أمر نظام.` });
      } else if (name && FS_DESTRUCTIVE_NAMES.has(name)) {
        push(node, { code: "FS-DESTRUCTIVE", severity: "high", confidence: "high", message: `استدعاء ${name}(): حذف من نظام الملفات.` });
      }
    } else if (node.type === "NewExpression" && node.callee?.type === "Identifier" && node.callee.name === "Function") {
      push(node, { code: "JS-NEW-FUNCTION", severity: "critical", confidence: "certain", message: "استخدام new Function(): إنشاء وتنفيذ كود ديناميكي." });
    } else if (node.type === "AssignmentExpression" && node.left?.type === "MemberExpression" &&
               !node.left.computed && node.left.property?.type === "Identifier" && node.left.property.name === "innerHTML") {
      push(node, { code: "DOM-INNERHTML", severity: "high", confidence: "high", message: "تعديل innerHTML مباشرة؛ قد يسبب XSS إن كان المصدر غير موثوق." });
    } else if (node.type === "JSXAttribute" && node.name?.name === "dangerouslySetInnerHTML") {
      push(node, { code: "REACT-RAW-HTML", severity: "high", confidence: "high", message: "استخدام dangerouslySetInnerHTML؛ راجع مصدر HTML والتعقيم." });
    } else if ((node.type === "ObjectProperty" || node.type === "Property") && node.key?.type === "Identifier" &&
               SECRET_KEY_NAME.test(node.key.name) && node.value?.type === "StringLiteral" &&
               node.value.value.length >= 8 && !PLACEHOLDER_VALUE.test(node.value.value)) {
      push(node, { code: "HARDCODED-SECRET", severity: "warning", confidence: "medium", message: `قيمة نصية طويلة على حقل باسم "${node.key.name}"؛ تحقق أنه ليس سرًا فعليًا مكتوبًا في الكود.` });
    } else if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" &&
               SECRET_KEY_NAME.test(node.id.name) && node.init?.type === "StringLiteral" &&
               node.init.value.length >= 8 && !PLACEHOLDER_VALUE.test(node.init.value)) {
      push(node, { code: "HARDCODED-SECRET", severity: "warning", confidence: "medium", message: `قيمة نصية طويلة في متغيّر باسمه "${node.id.name}"؛ تحقق أنه ليس سرًا فعليًا مكتوبًا في الكود.` });
    } else if (node.type === "BinaryExpression" && node.operator === "+") {
      const lit = node.left?.type === "StringLiteral" ? node.left : node.right?.type === "StringLiteral" ? node.right : null;
      const other = lit === node.left ? node.right : node.left;
      if (lit && SQL_KEYWORD.test(lit.value) && other && other.type !== "StringLiteral") {
        push(node, { code: "SQL-CONCAT", severity: "high", confidence: "medium", message: "تركيب استعلام SQL بجمع نص + متغيّر؛ استخدم parameterized queries." });
      }
    } else if (node.type === "TemplateLiteral" && node.expressions?.length > 0 &&
               node.quasis?.some(q => SQL_KEYWORD.test(q.value?.raw || ""))) {
      push(node, { code: "SQL-CONCAT", severity: "high", confidence: "medium", message: "استعلام SQL داخل template literal مع تضمين متغيّرات؛ استخدم parameterized queries." });
    }
  });

  return findings;
}

/**
 * Produces a combined, informational report: the AST-based change summary (imports/
 * exports/functions/classes/variables added, removed, or modified — from
 * summarizeChanges) plus an AST-based security scan of the patched code. Nothing here
 * gates the commit unless the caller explicitly passes `strict: true`, in which case a
 * "critical" finding flips `decision` to "BLOCKED" and `ok` to false. The default is
 * report-only, because a heuristic — even an AST-aware one — is still a heuristic.
 */
export function auditCodeChange({ before, after, fileName = "source.txt", fileType = "text", strict = false } = {}) {
  const oldCode = String(before ?? ""), newCode = String(after ?? "");
  const changes = summarizeChanges(oldCode, newCode, fileType);

  let findings = [];
  let scanned = false;
  if (JS_LIKE.has(fileType)) {
    const { ast, error } = parseJsAst(newCode, fileType);
    if (!error) { findings = scanAst(ast, newCode); scanned = true; }
  } else if (["python","java","c","h","cc","cpp","cxx","hpp","hh","hxx","go"].includes(fileType)) {
    const normalizedLanguage = fileType === "h" ? "c" : ["cc","cpp","cxx","hpp","hh","hxx"].includes(fileType) ? "cpp" : fileType;
    findings = scanNonJsSecurity(newCode, normalizedLanguage);
    scanned = true;
  }

  const counts = { critical: 0, high: 0, warning: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const blocking = strict ? findings.filter(f => f.severity === "critical") : [];
  const risk = counts.critical ? "CRITICAL" : counts.high ? "HIGH" : counts.warning ? "MEDIUM" : "LOW";

  return {
    version: AUDITOR_VERSION,
    ok: blocking.length === 0,
    decision: blocking.length ? "BLOCKED" : (counts.critical || counts.high) ? "WARNING" : "SAFE",
    risk,
    file: { name: fileName, type: fileType },
    scanned, // false = this file type has no AST-based security scan (non-JS); absence of findings there is not a clean bill of health
    changes,
    findings: findings.slice(0, MAX_FINDINGS),
    blockingFindings: blocking,
    counts,
    explanation: strict
      ? "تم تفعيل Strict Security Gate: أي اكتشاف بدرجة critical يمنع الاعتماد. باقي الاكتشافات تبقى تحذيرية."
      : "كل الاكتشافات هنا تحذيرية وإعلامية فقط ولا تمنع الاعتماد؛ فعّل Strict Security Gate إذا أردت تحويل الحالات الحرجة إلى حظر صريح.",
  };
}
