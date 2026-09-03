/**
 * Code Patcher v4 Safe Core
 *
 * Security invariant:
 *   No partial commit. A transaction is committed only after:
 *   parse -> plan -> apply -> per-step verification -> full replay -> validation -> integrity.
 *
 * The engine never executes user code. JavaScript/JSX/TypeScript/TSX validation uses
 * @babel/parser strictly as a parser: it only builds an AST and is never traversed to
 * generate executable code, and nothing produced from it is ever run. This is weaker
 * than "type-checking" but strictly stronger than a hand-rolled bracket scanner, and it
 * understands real-world syntax (ES Modules, JSX, TS types/decorators) that a naive
 * `Function()` parse cannot.
 */
import { parse as babelParse } from "@babel/parser";
import { sha256 } from "./cryptoUtils.js";
export { sha256 };

export const VERSION = "23.0.0";

export const MATCH_MODES = Object.freeze({
  EXACT_UNIQUE: "exact-unique",
  NORMALIZED_UNIQUE: "normalized-unique",
  REVIEW: "review",
});

export const FILE_TYPES = [
  "auto", "javascript", "typescript", "jsx", "tsx", "json", "jsonc", "html", "xml", "css", "python", "java", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "go", "text",
];

export const LIMITS = Object.freeze({
  maxSourceChars: 5_000_000,
  maxPatchChars: 2_000_000,
  maxPatches: 500,
  maxMatchesReported: 50,
  maxPatchIdChars: 128,
  maxPatchOperations: 2_000_000,
  maxPatchTotalChars: 4_000_000,
  maxHistoryEntries: 20,
  maxDiffLines: 12_000,
});

export const JS_LIKE = new Set(["javascript", "typescript", "jsx", "tsx"]);
const WS_TO_SPACE = /[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g;

export function detectLineEnding(text) {
  const info = analyzeLineEndings(text);
  return info.preferred;
}

export function analyzeLineEndings(text) {
  const s = String(text ?? "");
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\r") {
      if (s[i + 1] === "\n") { crlf++; i++; } else cr++;
    } else if (s[i] === "\n") lf++;
  }
  const total = crlf + lf + cr;
  const kinds = [crlf, lf, cr].filter(Boolean).length;
  return {
    crlf, lf, cr, total,
    mixed: kinds > 1,
    preferred: crlf >= lf && crlf >= cr && crlf ? "\r\n" : lf >= cr && lf ? "\n" : cr ? "\r" : "\n",
  };
}

export function detectFileType(name = "") {
  const base = String(name).toLowerCase().split(/[\\/]/).pop() || "";
  const ext = base.includes(".") ? base.split(".").pop() : "";
  const map = {
    js: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", mts: "typescript", cts: "typescript",
    jsx: "jsx", tsx: "tsx",
    json: "json", jsonc: "jsonc",
    html: "html", htm: "html", xhtml: "html",
    xml: "xml",
    css: "css", scss: "css", less: "css",
    py: "python", pyw: "python",
    java: "java", c: "c", h: "h", cc: "cc", cpp: "cpp", cxx: "cxx",
    hpp: "hpp", hh: "hh", hxx: "hxx", go: "go",
  };
  return map[ext] || "text";
}

function byteLength(text) {
  return new TextEncoder().encode(String(text ?? "")).byteLength;
}

export function sizeInfo(text) {
  const s = String(text ?? "");
  return { chars: s.length, bytes: byteLength(s) };
}

function splitLines(text) {
  const s = String(text ?? "");
  const lines = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\r" || s[i] === "\n") {
      const contentEnd = i;
      const ending = s[i] === "\r" && s[i + 1] === "\n" ? "\r\n" : s[i];
      const end = i + ending.length;
      lines.push({ text: s.slice(start, contentEnd), ending, start, end: contentEnd });
      start = end;
      i = end - 1;
    }
  }
  if (start < s.length || s.length === 0) lines.push({ text: s.slice(start), ending: "", start, end: s.length });
  return lines;
}

function lineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      if (text[i + 1] === "\n") i++;
      offsets.push(i + 1);
    } else if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function locate(text, index) {
  const offsets = lineOffsets(text);
  let lo = 0, hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= index) lo = mid + 1; else hi = mid - 1;
  }
  return hi + 1;
}

function normalizeEol(text, ending = "\n") {
  return String(text ?? "").replace(/\r\n|\r|\n/g, ending);
}

function normalizeLine(line) {
  return String(line)
    .replace(WS_TO_SPACE, " ")
    .trim()
    .replace(/[ \t]+/g, " ");
}

function canonicalLines(text, normalized = false) {
  return splitLines(text).map(x => normalized ? normalizeLine(x.text) : x.text);
}

function countMatchesByLines(source, search, normalized = false) {
  const src = canonicalLines(source, normalized);
  const needle = canonicalLines(search, normalized);
  while (needle.length && needle[needle.length - 1] === "") needle.pop();
  if (!needle.length || needle.every(x => x === "")) return [];

  const srcLines = splitLines(source);
  const hits = [];
  for (let i = 0; i <= src.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (src[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) {
      const first = srcLines[i];
      const last = srcLines[i + needle.length - 1];
      const wantsTrailingEol = /(?:\r\n|\r|\n)$/.test(String(search));
      hits.push({ start: first.start, end: wantsTrailingEol ? last.end + last.ending.length : last.end });
      if (hits.length > LIMITS.maxMatchesReported) break;
    }
  }
  return hits;
}

function findAllExact(source, search) {
  // If no line break is involved, exact character matching is unambiguous and fast.
  if (!/[\r\n]/.test(search)) {
    const hits = [];
    let pos = 0;
    while (pos <= source.length - search.length) {
      const idx = source.indexOf(search, pos);
      if (idx === -1) break;
      hits.push(idx);
      if (hits.length > LIMITS.maxMatchesReported) break;
      pos = idx + Math.max(1, search.length);
    }
    return hits.map(start => ({ start, end: start + search.length }));
  }
  return countMatchesByLines(source, search, false);
}

function normalizedMatches(source, search) {
  return countMatchesByLines(source, search, true);
}

function isSafeId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= LIMITS.maxPatchIdChars && !/[\r\n\[\]]/.test(id);
}

function pushError(errors, error) {
  errors.push(error);
}

export function parsePatchBlocks(input) {
  const text = String(input ?? "");
  if (text.length > LIMITS.maxPatchChars || byteLength(text) > LIMITS.maxPatchChars * 4) {
    return { blocks: [], errors: [{ type: "size-limit", line: 1, message: `ملف الـPatch يتجاوز الحد الآمن (${LIMITS.maxPatchChars.toLocaleString()} حرف).` }], parsedCount: 0 };
  }

  const lines = splitLines(text);
  const blocks = [];
  const errors = [];
  let i = 0;
  let ordinal = 0;
  let consumedEnd = 0;
  let sawNonWhitespace = false;

  const startRe = /^(?:<{7}\s*SEARCH(?:\s*\[PATCH:\s*([^\]]+)\])?|SEARCH\s*>{7}(?:\s*\[PATCH:\s*([^\]]+)\])?)\s*$/i;
  const sepRe = /^={6,7}\s*$/;
  const endRe = /^(?:>{7}\s*REPLACE|REPLACE\s*<{7})\s*$/i;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.text.trim()) { i++; continue; }
    sawNonWhitespace = true;
    const start = line.text.match(startRe);
    if (!start) {
      pushError(errors, { type: "unexpected-content", line: i + 1, message: "يوجد نص خارج كتل SEARCH/REPLACE؛ تم رفض الـPatch بالكامل." });
      i++;
      continue;
    }

    const startLine = i + 1;
    const blockStart = line.start;
    const id = (start[1] || start[2] || `patch-${ordinal + 1}`).trim();
    if (!isSafeId(id)) {
      pushError(errors, { type: "invalid-id", line: startLine, id, message: `معرّف Patch غير صالح: ${id}` });
    }
    i++;

    const searchLines = [];
    while (i < lines.length && !sepRe.test(lines[i].text)) {
      if (endRe.test(lines[i].text)) {
        pushError(errors, { type: "missing-separator", line: startLine, id, message: `الـSEARCH في ${id} لا يحتوي على فاصل صالح.` });
        break;
      }
      searchLines.push(lines[i++]);
    }
    if (i >= lines.length || !sepRe.test(lines[i]?.text || "")) {
      pushError(errors, { type: "missing-separator", line: startLine, id, message: `الـSEARCH للكتلة ${id} لا يحتوي على فاصل =======` });
      break;
    }
    i++;

    const replaceLines = [];
    let markerCollision = false;
    while (i < lines.length && !endRe.test(lines[i].text)) {
      if (sepRe.test(lines[i].text)) markerCollision = true;
      replaceLines.push(lines[i++]);
    }
    if (markerCollision) {
      pushError(errors, { type: "ambiguous-marker", line: startLine, id, message: `الكتلة ${id} تحتوي على سطر ======= داخل REPLACE؛ هذا التنسيق لا يسمح بتمييزه بأمان.` });
    }
    if (i >= lines.length) {
      pushError(errors, { type: "missing-end", line: startLine, id, message: `الكتلة ${id} لا تحتوي على >>>>>>> REPLACE` });
      break;
    }

    const endMarker = lines[i];
    const blockEnd = endMarker.end + endMarker.ending.length;
    const search = searchLines.map(x => x.text + x.ending).join("");
    const replace = replaceLines.map(x => x.text + x.ending).join("");
    // The formatting newline immediately before a marker is part of the block syntax,
    // not part of the user's SEARCH/REPLACE payload. Remove exactly one final EOL.
    const stripOneEol = value => value.replace(/\r\n|\r|\n$/, "");
    const cleanSearch = stripOneEol(search);
    const cleanReplace = stripOneEol(replace);

    ordinal++;
    if (!cleanSearch.trim()) {
      pushError(errors, { type: "empty-search", line: startLine, id, message: `الـSEARCH في ${id} فارغ؛ تم رفضه.` });
    } else if (isSafeId(id)) {
      blocks.push({ id, ordinal, startLine, search: cleanSearch, replace: cleanReplace, sourceRange: { start: blockStart, end: blockEnd } });
    }
    consumedEnd = Math.max(consumedEnd, blockEnd);
    i++;
  }

  const seen = new Set();
  for (const block of blocks) {
    if (seen.has(block.id)) pushError(errors, { type: "duplicate-id", line: block.startLine, id: block.id, message: `معرّف Patch مكرر: ${block.id}` });
    seen.add(block.id);
  }

  if (!sawNonWhitespace && !blocks.length) pushError(errors, { type: "no-blocks", line: 1, message: "لم يتم إدخال أي Patch." });
  if (blocks.length > LIMITS.maxPatches) pushError(errors, { type: "patch-limit", line: 1, message: `عدد الـPatches يتجاوز الحد ${LIMITS.maxPatches}.` });
  if (consumedEnd < text.length && text.slice(consumedEnd).trim()) {
    pushError(errors, { type: "unexpected-content", line: locate(text, consumedEnd), message: "يوجد نص خارج كتل Patch؛ تم رفض المدخل." });
  }

  return { blocks, errors, parsedCount: blocks.length };
}

export function analyzePatch(currentCode, patch, mode = MATCH_MODES.EXACT_UNIQUE) {
  const search = String(patch?.search ?? "");
  if (!search.trim()) return { status: "error", reason: "empty-search", patch };

  const exact = findAllExact(currentCode, search);
  if (exact.length === 1) {
    const hit = exact[0];
    return { status: "safe", level: "exact", start: hit.start, end: hit.end, line: locate(currentCode, hit.start), matches: 1, patch };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", level: "exact", matches: exact.length, locations: exact.slice(0, LIMITS.maxMatchesReported).map(x => locate(currentCode, x.start)), patch, reason: "multiple-exact-matches" };
  }

  if (mode === MATCH_MODES.NORMALIZED_UNIQUE || mode === MATCH_MODES.REVIEW) {
    const normalized = normalizedMatches(currentCode, search);
    if (normalized.length === 1) {
      const hit = normalized[0];
      return { status: mode === MATCH_MODES.NORMALIZED_UNIQUE ? "safe" : "review", level: "normalized", start: hit.start, end: hit.end, line: locate(currentCode, hit.start), matches: 1, patch };
    }
    if (normalized.length > 1) {
      return { status: "ambiguous", level: "normalized", matches: normalized.length, locations: normalized.slice(0, LIMITS.maxMatchesReported).map(x => locate(currentCode, x.start)), patch, reason: "multiple-normalized-matches" };
    }
  }
  return { status: "not-found", patch, reason: "search-not-found" };
}

function replacementForAnalysis(currentCode, analysis) {
  const replacement = normalizeEol(analysis.patch.replace ?? "", detectLineEnding(currentCode));
  if (analysis.level !== "normalized") return replacement;

  // Normalized matching must not silently erase formatting that was outside the
  // normalized content. Preserve the source line's leading/trailing whitespace
  // while replacing only the normalized body. This keeps indentation stable.
  const sourceLines = splitLines(currentCode.slice(analysis.start, analysis.end));
  const replacementLines = splitLines(replacement);
  if (sourceLines.length !== replacementLines.length) return replacement;
  return replacementLines.map((line, i) => {
    const source = sourceLines[i].text;
    const leading = source.match(/^[ \t]*/)?.[0] ?? "";
    const trailing = source.match(/[ \t]*$/)?.[0] ?? "";
    const body = line.text.replace(/^[ \t]*/, "").replace(/[ \t]*$/, "");
    const eol = i < replacementLines.length - 1
      ? detectLineEnding(currentCode)
      : (sourceLines[i]?.ending ? sourceLines[i].ending : "");
    return leading + body + trailing + eol;
  }).join("");
}

export function applyOne(currentCode, analysis) {
  if (!analysis || !["safe", "review"].includes(analysis.status)) throw new Error("Cannot apply an unsafe analysis");
  const expected = currentCode.slice(analysis.start, analysis.end);
  if (analysis.level === "exact") {
    const expectedCanonical = normalizeEol(expected, "\n");
    const searchCanonical = normalizeEol(analysis.patch.search, "\n");
    if (expectedCanonical !== searchCanonical) throw new Error(`Integrity check failed before Patch ${analysis.patch.id}`);
  } else if (normalizeLineBlock(expected) !== normalizeLineBlock(analysis.patch.search)) {
    throw new Error(`Normalized integrity check failed before Patch ${analysis.patch.id}`);
  }
  const replacement = replacementForAnalysis(currentCode, analysis);
  return currentCode.slice(0, analysis.start) + replacement + currentCode.slice(analysis.end);
}

function normalizeLineBlock(text) {
  return canonicalLines(text, true).join("\n").replace(/\n+$/, "");
}

export function verifyAppliedStep(before, after, analysis) {
  if (!analysis?.applied && analysis?.status !== "safe" && analysis?.status !== "review") return { ok: false, reason: "invalid-analysis" };
  const replacement = replacementForAnalysis(before, analysis);
  const expected = before.slice(0, analysis.start) + replacement + before.slice(analysis.end);
  if (after !== expected) return { ok: false, reason: "deterministic-reconstruction-mismatch", patchId: analysis.patch?.id };
  return { ok: true, start: analysis.start, end: analysis.end, replacementLength: replacement.length };
}

function patchKey(p) { return `${p?.ordinal ?? ""}:${p?.id ?? ""}`; }

export function buildExpectedPlan(original, patches, options = {}) {
  if (!Array.isArray(patches) || patches.length === 0) return { ok: false, reason: "no-patches", plan: [] };
  let current = String(original ?? "");
  const plan = [];
  const seen = new Set();
  let operations = 0;
  let totalPatchChars = 0;

  for (const patch of patches) {
    if (seen.has(patchKey(patch))) return { ok: false, reason: "duplicate-patch-key", patchId: patch.id, plan };
    seen.add(patchKey(patch));
    const analysis = analyzePatch(current, patch, options.mode || MATCH_MODES.EXACT_UNIQUE);
    const allowed = analysis.status === "safe" || (analysis.status === "review" && options.allowReviewApply === true);
    if (!allowed) return { ok: false, reason: analysis.reason || analysis.status, patchId: patch.id, plan: [...plan, { ...analysis, applied: false }] };
    operations += 1;
    totalPatchChars += patch.search.length + patch.replace.length;
    if (operations > LIMITS.maxPatchOperations) return { ok: false, reason: "operation-budget-exceeded", patchId: patch.id, plan };
    if (totalPatchChars > LIMITS.maxPatchTotalChars) return { ok: false, reason: "patch-character-budget-exceeded", patchId: patch.id, plan };
    const next = applyOne(current, analysis);
    const verified = verifyAppliedStep(current, next, analysis);
    if (!verified.ok) return { ok: false, reason: verified.reason, patchId: patch.id, plan };
    const record = { ...analysis, applied: true, beforeHashInputLength: current.length, afterHashInputLength: next.length, replacementLength: verified.replacementLength };
    plan.push(record);
    current = next;
  }

  return { ok: true, code: current, plan, appliedCount: plan.length };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

export function createPatchPlan(originalCode, patches, options = {}) {
  const original = String(originalCode ?? "");
  const result = buildExpectedPlan(original, patches, options);
  if (!result.ok) return { ok:false, reason:result.reason, failedPatchId:result.patchId, plan:result.plan || [] };
  const patchManifest = (patches || []).map(p => ({ id:p.id, ordinal:p.ordinal, search:p.search, replace:p.replace }));
  const plan = {
    schemaVersion: 2,
    engineVersion: VERSION,
    originalLength: original.length,
    patches: patchManifest,
    operations: result.plan.map(x => ({
      id:x.patch?.id, ordinal:x.patch?.ordinal, level:x.level, start:x.start, end:x.end, line:x.line, replacementLength:x.replacementLength,
    })),
    resultLength: result.code.length,
  };
  deepFreeze(plan);
  return { ok:true, code:result.code, appliedCount:result.appliedCount, plan, execution:result.plan };
}

export async function analyzeAndApply(originalCode, patches, options = {}) {
  const original = String(originalCode ?? "");
  const mode = options.mode || MATCH_MODES.EXACT_UNIQUE;
  if (original.length > LIMITS.maxSourceChars || byteLength(original) > LIMITS.maxSourceChars * 4) return { ok: false, code: original, results: [], rolledBack: true, reason: "source-size-limit" };
  if (!Array.isArray(patches) || patches.length === 0) return { ok: false, code: original, results: [], rolledBack: true, reason: "no-patches" };
  if (patches.length > LIMITS.maxPatches) return { ok: false, code: original, results: [], rolledBack: true, reason: "patch-limit" };

  const planned = buildExpectedPlan(original, patches, { mode, allowReviewApply: options.allowReviewApply === true });
  if (!planned.ok) {
    return { ok: false, code: original, results: planned.plan || [], rolledBack: true, reason: planned.reason, failedPatchId: planned.patchId };
  }
  return { ok: true, code: planned.code, results: planned.plan, rolledBack: false, partial: false, reason: null, appliedCount: planned.appliedCount };
}

export function verifyTransaction(original, finalCode, patches, appliedResults, options = {}) {
  const source = String(original ?? "");
  const target = String(finalCode ?? "");
  if (!Array.isArray(patches) || !Array.isArray(appliedResults) || patches.length !== appliedResults.length) {
    return { ok: false, reason: "transaction-record-count-mismatch" };
  }
  let current = source;
  const replay = [];
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    const recorded = appliedResults[i];
    if (!recorded || patchKey(recorded.patch) !== patchKey(patch) || recorded.applied !== true) return { ok: false, reason: "transaction-record-mismatch", patchId: patch.id };
    const fresh = analyzePatch(current, patch, options.mode || MATCH_MODES.EXACT_UNIQUE);
    const allowed = fresh.status === "safe" || (fresh.status === "review" && options.allowReviewApply === true);
    if (!allowed) return { ok: false, reason: "replay-analysis-failed", patchId: patch.id };
    if (fresh.start !== recorded.start || fresh.end !== recorded.end || fresh.level !== recorded.level) return { ok: false, reason: "recorded-span-mismatch", patchId: patch.id };
    const next = applyOne(current, fresh);
    const step = verifyAppliedStep(current, next, fresh);
    if (!step.ok) return step;
    replay.push(next);
    current = next;
  }
  if (current !== target) return { ok: false, reason: "final-reconstruction-mismatch" };
  return { ok: true, appliedCount: patches.length, identical: source === target, replay };
}

export function verifyUntouched(original, patched, patches, appliedResults, options = {}) {
  const tx = verifyTransaction(original, patched, patches, appliedResults, options);
  if (!tx.ok) return { ok:false, reason:tx.reason, identical:false, regions:[] };
  let current=String(original ?? ""), nextIndex=0, regions=[];
  for(let i=0;i<patches.length;i++){
    const a=analyzePatch(current,patches[i],options.mode||MATCH_MODES.EXACT_UNIQUE);
    if(!["safe","review"].includes(a.status)) return {ok:false,reason:"untouched-reanalysis-failed",regions};
    const next=applyOne(current,a), replacement=replacementForAnalysis(current,a);
    const beforePrefix=current.slice(0,a.start), beforeSuffix=current.slice(a.end);
    const afterPrefix=next.slice(0,a.start), afterSuffix=next.slice(a.start+replacement.length);
    if(beforePrefix!==afterPrefix||beforeSuffix!==afterSuffix)return {ok:false,reason:"untouched-region-changed",patchId:patches[i].id,regions};
    regions.push({patchId:patches[i].id,start:a.start,end:a.end,replacementLength:replacement.length,verified:true});
    current=next; nextIndex=a.end;
  }
  return {ok:current===String(patched ?? ""),reason:current===String(patched ?? "")?null:"final-code-mismatch",identical:String(original ?? "")===String(patched ?? ""),regions};
}



function structuralScan(code) {
  const s = String(code ?? "");
  const stack = [];
  let quote = null, escaped = false, lineComment = false, blockComment = false;
  let template = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (lineComment) { if (c === "\n" || c === "\r") lineComment = false; continue; }
    if (blockComment) { if (c === "*" && n === "/") { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === quote) { quote = null; template = false; }
      continue;
    }
    if (c === "/" && n === "/") { lineComment = true; i++; continue; }
    if (c === "/" && n === "*") { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; template = c === "`"; continue; }
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      const expected = c === ")" ? "(" : c === "]" ? "[" : "{";
      if (stack.pop() !== expected) return { ok: false, reason: `قوس غير متوازن عند الحرف ${i + 1}.` };
    }
  }
  if (quote) return { ok: false, reason: "سلسلة نصية غير مغلقة." };
  if (blockComment) return { ok: false, reason: "تعليق متعدد الأسطر غير مغلق." };
  if (stack.length) return { ok: false, reason: "أقواس غير مغلقة." };
  return { ok: true };
}

// Stable, well-established syntax plugins enabled for every JS-family type. These cover
// common modern syntax (ESM import attributes, top-level await, decorators, `using`)
// without ever changing execution semantics — parse only.
const BASE_JS_PLUGINS = ["importAttributes", "topLevelAwait", "explicitResourceManagement", "decorators-legacy"];
const JS_TYPE_LABEL = { javascript: "JavaScript", jsx: "JSX", typescript: "TypeScript", tsx: "TSX" };

function babelPluginsFor(type) {
  const plugins = [...BASE_JS_PLUGINS];
  if (type === "typescript" || type === "tsx") plugins.push("typescript");
  if (type === "jsx" || type === "tsx") plugins.push("jsx");
  return plugins;
}

/**
 * Single source of truth for parsing JS-family source into an AST. Used by validation,
 * the change summary, and the code auditor, so all three always agree on exactly which
 * syntax is accepted — no drift between "what validates" and "what gets audited".
 * Parse only: the AST is data, never traversed into executable code, never invoked.
 */
export function parseJsAst(code, type) {
  try {
    return { ast: babelParse(String(code ?? ""), { sourceType: "unambiguous", plugins: babelPluginsFor(type), errorRecovery: false }), error: null };
  } catch (error) {
    return { ast: null, error };
  }
}

function validateJavaScript(code, type) {
  const label = JS_TYPE_LABEL[type] || type.toUpperCase();
  const { error } = parseJsAst(code, type);
  if (!error) {
    return { ok: true, strength: "syntax", message: `${label} تم تحليله بمحلل نحوي (AST) فعلي بنجاح، بما يشمل ES Modules${type === "jsx" || type === "tsx" ? " وJSX" : ""}${type === "typescript" || type === "tsx" ? " وTypeScript" : ""}.` };
  }
  const loc = error?.loc ? ` (سطر ${error.loc.line}, عمود ${error.loc.column + 1})` : "";
  return { ok: false, strength: "syntax", message: `خطأ نحوي في ${label}${loc}: ${error?.message || "خطأ غير معروف"}` };
}

function validatePythonStructural(code) {
  const s = String(code ?? "");
  const structural = structuralScan(s.replace(/(^|\n)\s*#.*(?=\n|$)/g, "$1"));
  if (!structural.ok) return { ok: false, strength: "structural", message: structural.reason };
  const lines = s.split(/\r\n|\r|\n/);
  const indents = [0];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const leading = raw.match(/^[ \t]*/)?.[0] || "";
    if (leading.includes("\t") && leading.includes(" ")) return { ok: false, strength: "structural", message: `خلط tabs وspaces في السطر ${i + 1}.` };
    const width = leading.includes("\t") ? leading.replace(/\t/g, "    ").length : leading.length;
    if (width > indents[indents.length - 1]) indents.push(width);
    else while (width < indents[indents.length - 1] && indents.length > 1) indents.pop();
    if (width !== indents[indents.length - 1]) return { ok: false, strength: "structural", message: `Indentation غير متسقة في السطر ${i + 1}.` };
  }
  return { ok: true, strength: "structural", message: "Python اجتاز الفحص البنيوي المحافظ (لا يوجد Parser AST حقيقي متاح)." };
}

const PYTHON_AST_ENDPOINT = "/api/python-ast";
const PY_AST = decodeURIComponent(new URL("../api/python-ast.py", import.meta.url).pathname);

/**
 * Calls the real CPython `ast`-based service (api/python-ast.py). Parsing only — the
 * service never executes submitted Python. Returns `{ unavailable: true, ... }` when the
 * service can't be reached at all (no `fetch`, network failure, non-2xx, bad JSON) so the
 * caller can distinguish "the service told us this code is invalid" from "we couldn't ask".
 * Exported so codeAuditor.js can reuse the exact same AST for its change-summary/security
 * findings instead of re-parsing or duplicating this request logic.
 */
export async function fetchPythonAst(code, fileName = "file.py") {
  const source = String(code ?? "");
  if (source.length > LIMITS.maxSourceChars) return { ok: false, unavailable: false, error: "source exceeds safety limit" };

  // Node/server path: use the bundled CPython AST helper directly. This avoids the
  // previous bug where Node's global fetch received a relative URL (/api/python-ast)
  // and validation silently degraded to the weak structural checker.
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const input = JSON.stringify({ code: source, file_name: String(fileName || "file.py") });
      const childProcess = process.getBuiltinModule?.("node:child_process");
      if (!childProcess?.spawn) return { ok:false, unavailable:true, error:"Node child_process builtin is unavailable." };
      const result = await new Promise((resolve) => {
        const child = childProcess.spawn("python3", [PY_AST], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
        let stdout = "", stderr = "", settled = false;
        const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
        const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ ok:false, unavailable:true, error:"Python AST helper timed out." }); }, 30_000);
        child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) { child.kill("SIGKILL"); finish({ ok:false, unavailable:true, error:"Python AST response exceeded safety limit." }); } });
        child.stderr.on("data", chunk => { stderr += chunk; if (Buffer.byteLength(stderr) > 1 * 1024 * 1024) child.kill("SIGKILL"); });
        child.on("error", error => { clearTimeout(timer); finish({ ok:false, unavailable:true, error:error?.message || "Python executable unavailable." }); });
        child.on("close", code => { clearTimeout(timer); if (settled) return; if (code !== 0) return finish({ ok:false, unavailable:true, error:(stderr || stdout || `Python AST helper exited with ${code}.`).trim() }); try { finish(JSON.parse(stdout)); } catch { finish({ ok:false, unavailable:true, error:"Python AST helper returned invalid JSON." }); } });
        child.stdin.end(input);
      });
      return result;
    } catch (error) {
      return { ok:false, unavailable:true, error:`تعذر تشغيل Python AST helper: ${error?.message || error}` };
    }
  }

  if (typeof fetch !== "function") return { ok:false, unavailable:true, error:"fetch غير متاح في بيئة التشغيل الحالية." };
  try {
    const endpoint = (typeof import.meta !== "undefined" && import.meta.env?.VITE_PYTHON_AST_URL) || PYTHON_AST_ENDPOINT;
    const response = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: source, file_name: String(fileName || "file.py") }),
    });
    if (!response.ok) return { ok:false, unavailable:true, error:`Python AST service أعاد HTTP ${response.status}.` };
    const result = await response.json();
    if (!result || typeof result !== "object") return { ok:false, unavailable:true, error:"استجابة غير صالحة من Python AST service." };
    return result;
  } catch (error) {
    return { ok:false, unavailable:true, error:`تعذر الوصول إلى Python AST service: ${error?.message || error}` };
  }
}

/**
 * Real AST validation via the Python stdlib `ast` module (see api/python-ast.py).
 * Validation is fail-closed: an unavailable AST service is not treated as valid Python.
 * Node/server execution uses the bundled helper directly; browser execution uses the
 * configured HTTP endpoint. A definite syntax error is always preserved as a real error.
 */
export async function validatePython(code, fileName = "file.py") {
  const result = await fetchPythonAst(code, fileName);
  if (result.unavailable) {
    return { ok:false, strength:"unavailable", unavailable:true, service:"unavailable", message:`تعذر الوصول إلى Python AST validator: ${result.error || "الخدمة غير متاحة"}` };
  }
  if (result.ok === false) {
    const loc = result.line ? ` (سطر ${result.line}, عمود ${result.column || 1})` : "";
    return { ok: false, strength: "ast", message: `خطأ نحوي في Python${loc}: ${result.error || "AST parse failed"}` };
  }
  return {
    ok: true,
    strength: "ast",
    message: "Python تم تحليله بمحلل AST حقيقي (CPython ast) بنجاح، دون تنفيذ أي كود.",
    ast: result.ast || null,
    findings: result.findings || [],
  };
}

function validateJson(code, allowComments = false) {
  let input = String(code ?? "").replace(/^\uFEFF/, "");
  if (allowComments) input = stripJsonComments(input);
  try { JSON.parse(input); return { ok: true, strength: "syntax", message: "JSON syntax صالح." }; }
  catch (error) { return { ok: false, strength: "syntax", message: `JSON غير صالح: ${error?.message || "خطأ غير معروف"}` }; }
}

function stripJsonComments(s) {
  let out = "", quote = false, esc = false, line = false, block = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (line) { if (c === "\n" || c === "\r") { line = false; out += c; } else out += " "; continue; }
    if (block) { if (c === "*" && n === "/") { block = false; out += "  "; i++; } else out += c === "\n" || c === "\r" ? c : " "; continue; }
    if (quote) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') quote = false; continue; }
    if (c === '"') { quote = true; out += c; continue; }
    if (c === "/" && n === "/") { line = true; out += "  "; i++; continue; }
    if (c === "/" && n === "*") { block = true; out += "  "; i++; continue; }
    out += c;
  }
  return out;
}

// HTML5 void elements never have a closing tag and are not required to be self-closed
// with a trailing slash (`<br>`, `<img src="...">`, `<meta charset="...">` are all valid).
// XML has no such concept — every element there must be explicitly closed or self-closed
// to be well-formed — so this list only applies when xml === false.
const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function validateMarkup(code, xml = false) {
  const s = String(code ?? "");
  const stack = [];
  const tokenRe = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*?>/g;
  let m;
  let cursor = 0;
  while ((m = tokenRe.exec(s))) {
    const token = m[0];
    if (token.startsWith("<!--")) continue;
    const close = /^<\//.test(token);
    const selfClosing = /\/\s*>$/.test(token) || /^<\?(?:xml|[^>]+)\?>/i.test(token) || /^<!/.test(token);
    const name = token.match(/^<\/?\s*([A-Za-z][\w:.-]*)/)?.[1]?.toLowerCase();
    if (!name) continue;
    const isVoid = !xml && HTML_VOID_ELEMENTS.has(name);
    if (close) {
      if (isVoid) continue; // A stray `</br>` etc. is tolerated, not treated as a structural error.
      if (stack.pop() !== name) return { ok: false, strength: "structural", message: `وسم غير متوازن: ${name}.` };
    } else if (!selfClosing && !isVoid) {
      stack.push(name);
    }
    cursor = tokenRe.lastIndex;
  }
  if (/<!--/.test(s.slice(cursor)) && !/-->/s.test(s.slice(s.lastIndexOf("<!--")))) return { ok: false, strength: "structural", message: "تعليق HTML/XML غير مغلق." };
  if (stack.length) return { ok: false, strength: "structural", message: `وسم غير مغلق: ${stack[stack.length - 1]}.` };
  if (/<[^>]*$/.test(s.replace(/<!--[^]*?-->/g, ""))) return { ok: false, strength: "structural", message: "Tag غير مكتمل." };
  return { ok: true, strength: xml ? "structural" : "structural", message: `${xml ? "XML" : "HTML"} اجتاز الفحص البنيوي المحافظ.` };
}

function validateCss(code) {
  const structural = structuralScan(String(code ?? "").replace(/(^|\n)\s*\/\*[\s\S]*?\*\//g, "$1"));
  if (!structural.ok) return { ok: false, strength: "structural", message: structural.reason };
  const s = String(code ?? "");
  let braces = 0, quote = null, comment = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], n = s[i + 1];
    if (comment) { if (c === "*" && n === "/") { comment = false; i++; } continue; }
    if (!quote && c === "/" && n === "*") { comment = true; i++; continue; }
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") braces++;
    else if (c === "}") braces--;
    if (braces < 0) return { ok: false, strength: "structural", message: "CSS closing brace غير متوقع." };
  }
  if (quote || comment || braces !== 0) return { ok: false, strength: "structural", message: "CSS غير مكتمل." };
  return { ok: true, strength: "structural", message: "CSS اجتاز الفحص البنيوي المحافظ." };
}

const EXTRA_LANGUAGE_TYPES = new Set(["java","c","h","cc","cpp","cxx","hpp","hh","hxx","go"]);
function extraLanguageForType(type) {
  return EXTRA_LANGUAGE_TYPES.has(type) ? (type === "java" ? "java" : type === "go" ? "go" : type === "c" || type === "h" ? "c" : "cpp") : null;
}
async function validateExtraLanguage(code, type, fileName) {
  // Compiler-backed adapters are Node-only. Browser workers cannot spawn javac/clang/go;
  // fail closed there instead of importing Node built-ins into the browser bundle.
  if (typeof process === "undefined" || !process.versions?.node) return { ok: false, strength: "unavailable", unavailable: true, parser: null, message: `${type.toUpperCase()} compiler validation requires the server/Node adapter.` };
  try {
    // This function is only reachable in Node/server validation; importing the adapter
    // statically keeps CSP strict and avoids dynamic-code construction.
    const { parseExtraLanguage } = await import("./languageParsers.js");
    const parsed = parseExtraLanguage(String(code ?? ""), fileName || `source.${type}`);
    return {
      ok: parsed.ok === true, strength: parsed.strength || "real-ast", parser: parsed.parser || null,
      message: parsed.message || (parsed.ok ? "Compiler-backed AST validation succeeded." : "Compiler-backed validation failed."),
      line: parsed.line ?? null, column: parsed.column ?? null, unavailable: parsed.unavailable === true,
      ast: parsed.snapshot || null, snapshot: parsed.snapshot || null,
    };
  } catch (error) {
    return { ok: false, strength: "unavailable", unavailable: true, parser: null, message: `Compiler adapter unavailable: ${error?.message || error}` };
  }
}

export async function validateCode(code, fileType = "text", fileName = "file.py") {
  const type = fileType || "text";
  if (type === "text") return { ok: true, strength: "none", message: "ملف نصي: لا توجد لغة للتحقق منها." };
  if (type === "json") return validateJson(code, false);
  if (type === "jsonc") return validateJson(code, true);
  if (JS_LIKE.has(type)) return validateJavaScript(code, type);
  if (type === "python") return validatePython(code, fileName);
  if (extraLanguageForType(type)) return await validateExtraLanguage(code, type, fileName);
  if (type === "html") return validateMarkup(code, false);
  if (type === "xml") return validateMarkup(code, true);
  if (type === "css") return validateCss(code);
  return { ok: true, strength: "none", message: "نوع الملف غير مدعوم للتحقق اللغوي؛ لم يتم ادعاء صحة غير مثبتة." };
}

export function createDiff(original, result) {
  const a = String(original ?? "").split(/\r\n|\r|\n/);
  const b = String(result ?? "").split(/\r\n|\r|\n/);
  if (a.length + b.length > LIMITS.maxDiffLines) return [{ type: "info", line: "", text: "Diff مخفي لأن الملف كبير جدًا. سلامة العملية لا تعتمد على Diff." }];
  // Memory-bounded prefix/suffix diff. It intentionally does not pretend to be a full optimal diff.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1, endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
  const out = [];
  const context = 3;
  for (let i = Math.max(0, start - context); i < start; i++) out.push({ type: "same", line: i + 1, text: a[i] });
  for (let i = start; i <= endA; i++) out.push({ type: "remove", line: i + 1, text: a[i] });
  for (let i = start; i <= endB; i++) out.push({ type: "add", line: i + 1, text: b[i] });
  const tailStart = Math.max(start, endA + 1);
  for (let i = tailStart; i < Math.min(a.length, endA + 1 + context); i++) if (i >= start) out.push({ type: "same", line: i + 1, text: a[i] });
  return out.length ? out : [{ type: "same", line: 1, text: "لا يوجد تغيير." }];
}

export function createDownloadName(name = "source.txt") {
  let base = String(name).split(/[\\/]/).pop() || "source.txt";
  base = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").slice(0, 180) || "source.txt";
  const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;
  if (reserved.test(base)) base = `_${base}`;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? `${base.slice(0, dot)}_patched${base.slice(dot)}` : `${base}_patched.txt`;
}

export function finalizeTransaction(original, applied, validation, integrityOk = false, verificationOk = false) {
  const source = String(original ?? "");
  if (!applied || applied.rolledBack) return { committed: false, code: source, reason: applied?.reason || "engine-rollback" };
  if (!verificationOk) return { committed: false, code: source, reason: "verification-failure" };
  if (!integrityOk) return { committed: false, code: source, reason: "integrity-failure" };
  if (!validation?.ok) return { committed: false, code: source, reason: "post-validation-failure" };
  return { committed: true, code: applied.code, reason: null };
}

const CHANGE_KIND_LABEL = {
  "import": "استيراد (import)",
  "export-default": "export افتراضي",
  "export-named": "export مسمّى",
  "function": "دالة", "export-function": "دالة مُصدَّرة",
  "class": "كلاس", "export-class": "كلاس مُصدَّر",
  "variable": "متغيّر", "export-variable": "متغيّر مُصدَّر",
  "interface": "TS interface", "export-interface": "TS interface مُصدَّر",
  "type": "TS type", "export-type": "TS type مُصدَّر",
  "declaration": "تعريف", "export-declaration": "تعريف مُصدَّر",
};

function bindingName(id) {
  if (!id) return "?";
  if (id.type === "Identifier") return id.name;
  if (id.type === "ObjectPattern" || id.type === "ArrayPattern") return "(destructured)";
  return "?";
}

function describeDeclaration(node, exported) {
  const pfx = exported ? "export-" : "";
  if (node.type === "FunctionDeclaration") return [{ kind: `${pfx}function`, key: node.id?.name || "(anonymous)" }];
  if (node.type === "ClassDeclaration") return [{ kind: `${pfx}class`, key: node.id?.name || "(anonymous)" }];
  if (node.type === "VariableDeclaration") return node.declarations.map(d => ({ kind: `${pfx}variable`, key: bindingName(d.id) }));
  if (node.type === "TSInterfaceDeclaration") return [{ kind: `${pfx}interface`, key: node.id?.name }];
  if (node.type === "TSTypeAliasDeclaration") return [{ kind: `${pfx}type`, key: node.id?.name }];
  return [{ kind: `${pfx}declaration`, key: node.type }];
}

// Walks only the top level of the module/script — this intentionally does not recurse into
// function bodies. It answers "what top-level names changed?", not "what changed inside them",
// which keeps it fast and safe on large files.
function extractTopLevelSignature(ast, source) {
  const text = node => source.slice(node.start, node.end);
  const items = [];
  for (const node of ast.program.body) {
    let entries;
    if (node.type === "ImportDeclaration") entries = [{ kind: "import", key: node.source.value }];
    else if (node.type === "ExportDefaultDeclaration") entries = [{ kind: "export-default", key: "default" }];
    else if (node.type === "ExportNamedDeclaration") {
      entries = node.declaration
        ? describeDeclaration(node.declaration, true)
        : [{ kind: "export-named", key: (node.specifiers || []).map(s => s.exported?.name || s.exported?.value).sort().join(",") || "{}" }];
    } else entries = describeDeclaration(node, false);
    for (const e of entries) items.push({ ...e, text: text(node) });
  }
  return items;
}

function diffSignature(itemsA, itemsB) {
  const byKey = items => {
    const map = new Map();
    for (const it of items) {
      const compound = `${it.kind}:${it.key}`;
      const arr = map.get(compound) || [];
      arr.push(it);
      map.set(compound, arr);
    }
    return map;
  };
  const mapA = byKey(itemsA), mapB = byKey(itemsB);
  const keys = new Set([...mapA.keys(), ...mapB.keys()]);
  const added = [], removed = [], changed = [];
  for (const key of keys) {
    const a = mapA.get(key) || [], b = mapB.get(key) || [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i], y = b[i];
      if (x && !y) removed.push(x);
      else if (!x && y) added.push(y);
      else if (x.text !== y.text) changed.push({ kind: x.kind, key: x.key });
    }
  }
  const label = it => `${CHANGE_KIND_LABEL[it.kind] || it.kind}: ${it.key}`;
  return {
    kind: "semantic",
    added: added.map(label), removed: removed.map(label),
    changed: changed.map(label),
  };
}

function lineBasedSummary(original, patched) {
  const diff = createDiff(original, patched);
  let addedLines = 0, removedLines = 0;
  for (const d of diff) { if (d.type === "add") addedLines++; else if (d.type === "remove") removedLines++; }
  return { kind: "lines", addedLines, removedLines, identical: String(original ?? "") === String(patched ?? "") };
}

/**
 * Produces a human-readable summary of *what kind of thing* changed at the top level of the
 * file (functions/classes/variables/imports/exports added, removed, or modified). This is a
 * reporting/UX aid only — it plays no role in the commit decision, which is governed entirely
 * by verifyTransaction + validateCode + buildIntegrity above. For JS-family files it is
 * AST-based (via the same @babel/parser used for validation); for everything else, or if
 * either side fails to parse, it degrades to a safe line-count summary instead of guessing.
 */
export function summarizeChanges(original, patched, fileType) {
  const type = fileType || "text";
  if (JS_LIKE.has(type)) {
    const a = parseJsAst(original, type);
    const b = parseJsAst(patched, type);
    if (!a.error && !b.error) {
      return diffSignature(
        extractTopLevelSignature(a.ast, String(original ?? "")),
        extractTopLevelSignature(b.ast, String(patched ?? "")),
      );
    }
    // Either side didn't parse cleanly (shouldn't happen post-validation, but this
    // function must never throw) — fall back to the safe, dumb line count instead.
    return lineBasedSummary(original, patched);
  }
  return lineBasedSummary(original, patched);
}

/**
 * Same idea as summarizeChanges/diffSignature above, but for Python entities coming from
 * the real CPython AST snapshot (functions/classes/imports/exports — see api/python-ast.py)
 * instead of a Babel AST. Kept as a separate function rather than generalizing diffSignature
 * because the two source shapes (Babel node text-spans vs. plain AST-service records) are
 * different enough that sharing one implementation would need its own translation layer
 * anyway. Returns the same `{ kind: "semantic", added, removed, changed }` shape so the UI
 * needs no special-casing per language.
 */
function diffPythonEntities(beforeAst, afterAst) {
  const label = (kindLabel, name) => `${kindLabel}: ${name}`;
  const added = [], removed = [], changed = [];

  const diffByName = (beforeList, afterList, kindLabel, sameShape) => {
    const before = new Map((beforeList || []).map(x => [x.name, x]));
    const after = new Map((afterList || []).map(x => [x.name, x]));
    for (const [name, item] of after) {
      if (!before.has(name)) added.push(label(kindLabel, name));
      else if (!sameShape(before.get(name), item)) changed.push(label(kindLabel, name));
    }
    for (const [name] of before) if (!after.has(name)) removed.push(label(kindLabel, name));
  };

  diffByName(beforeAst.functions, afterAst.functions, "function", (a, b) => JSON.stringify(a.params) === JSON.stringify(b.params));
  diffByName(beforeAst.classes, afterAst.classes, "class", () => true);
  diffByName(
    (beforeAst.imports || []).map(x => ({ name: `${x.source}:${x.name}` })),
    (afterAst.imports || []).map(x => ({ name: `${x.source}:${x.name}` })),
    "import",
    () => true,
  );

  return { kind: "semantic", added, removed, changed };
}

/**
 * Python counterpart to summarizeChanges: needs its own async fetch of the "before" AST
 * since validateCode only ever validates the *patched* result, not the original. Purely a
 * reporting aid — never gates the commit, and degrades to a line-count summary (never
 * throws, never blocks) if either side isn't real AST data, exactly like summarizeChanges
 * does for JS-family files.
 */
export async function summarizePythonChanges(original, patched, afterAst = null) {
  const [beforeResult, afterResult] = await Promise.all([
    fetchPythonAst(original, "before.py"),
    afterAst ? Promise.resolve({ ok: true, ast: afterAst }) : fetchPythonAst(patched, "after.py"),
  ]);
  if (beforeResult.ok && afterResult.ok && beforeResult.ast && afterResult.ast) {
    return diffPythonEntities(beforeResult.ast, afterResult.ast);
  }
  return lineBasedSummary(original, patched);
}

export async function buildIntegrity(original, result, patches) {
  const source = String(original ?? "");
  const target = String(result ?? "");
  const patchManifest = patches.map(p => ({ id: p.id, ordinal: p.ordinal, search: p.search, replace: p.replace }));
  const [originalHash, resultHash, patchSetHash] = await Promise.all([
    sha256(source), sha256(target), sha256(JSON.stringify(patchManifest)),
  ]);
  return { ok: true, originalHash, resultHash, patchSetHash, changed: source !== target };
}
