/**
 * Code Patcher V7 - Unified AST Engine
 *
 * Design:
 * - JavaScript/TypeScript/JSX/TSX: Babel parser when installed.
 * - Python: isolated Python ast subprocess; parsing only, never execution.
 * - Semantic snapshots are normalized to language-neutral entities.
 * - Parser failures are fail-closed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import { parseExtraLanguage as parseCompilerLanguage, compilerLanguageForFile } from "./languageParsers.js";

const PY_AST = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "api", "python-ast.py");

const JS_EXTS = new Set([".js",".mjs",".cjs",".jsx",".ts",".tsx"]);
const PY_EXTS = new Set([".py"]);

function languageForFile(fileName = "") {
  const compilerLang = compilerLanguageForFile(fileName);
  if (compilerLang) return compilerLang;
  const ext = path.extname(fileName).toLowerCase();
  if (JS_EXTS.has(ext)) return ext === ".ts" || ext === ".tsx" ? "typescript" : "javascript";
  if (PY_EXTS.has(ext)) return "python";
  return "unknown";
}

function safeId(parts) {
  return parts.filter(Boolean).join(":");
}

function normalizeLocation(node) {
  return node && node.loc && node.loc.start
    ? { line: node.loc.start.line || null, column: node.loc.start.column || null }
    : { line: null, column: null };
}

function jsSnapshot(ast) {
  const entities = [];
  const imports = [];
  const exports = [];

  function add(kind, name, node, extra = {}) {
    entities.push({
      id: safeId([kind, name || "<anonymous>", normalizeLocation(node).line]),
      kind, name: name || "<anonymous>",
      location: normalizeLocation(node),
      ...extra
    });
  }

  function walk(node, parent = null) {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "FunctionDeclaration":
        add(node.async ? "async-function" : "function", node.id && node.id.name, node, {
          params: (node.params || []).map(paramName),
          generator: !!node.generator
        });
        break;
      case "ClassDeclaration":
        add("class", node.id && node.id.name, node);
        break;
      case "VariableDeclaration":
        for (const d of node.declarations || []) {
          if (d.id && d.id.type === "Identifier") add("variable", d.id.name, d);
        }
        break;
      case "ImportDeclaration":
        imports.push({
          source: node.source && node.source.value,
          specifiers: (node.specifiers || []).map(s => s.local && s.local.name).filter(Boolean),
          location: normalizeLocation(node)
        });
        break;
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        exports.push({
          type: node.type,
          names: exportNames(node),
          location: normalizeLocation(node)
        });
        break;
      default:
        break;
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(v => walk(v, node));
      else if (value && typeof value === "object" && value.type) walk(value, node);
    }
  }

  walk(ast);
  return { language: "javascript", entities, imports, exports };
}

function paramName(p) {
  if (!p) return "<unknown>";
  if (p.type === "Identifier") return p.name;
  if (p.type === "AssignmentPattern") return paramName(p.left);
  if (p.type === "RestElement") return "..." + paramName(p.argument);
  return "<complex>";
}

function exportNames(node) {
  if (!node) return [];
  if (node.type === "ExportDefaultDeclaration") return ["default"];
  if (node.type === "ExportAllDeclaration") return ["*"];
  if (node.declaration) {
    if (node.declaration.id && node.declaration.id.name) return [node.declaration.id.name];
    if (node.declaration.declarations) return node.declaration.declarations
      .map(d => d.id && d.id.name).filter(Boolean);
  }
  return (node.specifiers || []).map(s => (s.exported && s.exported.name) || null).filter(Boolean);
}

async function parseJavaScript(code, fileName = "file.js") {
  let parser;
  try {
    parser = await import("@babel/parser");
  } catch (e) {
    return { ok: false, language: "javascript", error: "Babel parser dependency is not installed" };
  }
  try {
    const ext = path.extname(fileName).toLowerCase();
    const plugins = [
      "jsx",
      "classProperties",
      "objectRestSpread",
      "optionalChaining",
      "nullishCoalescingOperator",
      "topLevelAwait",
      "dynamicImport",
      "importMeta",
      "decorators-legacy"
    ];
    if (ext === ".ts" || ext === ".tsx") plugins.push("typescript");
    const ast = parser.parse(code, {
      sourceType: "unambiguous",
      errorRecovery: false,
      plugins
    });
    const snap = jsSnapshot(ast);
    snap.language = (ext === ".ts" || ext === ".tsx") ? "typescript" : "javascript";
    return { ok: true, language: snap.language, ast, snapshot: snap };
  } catch (e) {
    return {
      ok: false,
      language: (path.extname(fileName).toLowerCase().includes("ts") ? "typescript" : "javascript"),
      error: e && e.message ? e.message : String(e),
      line: e && e.loc ? e.loc.line : null,
      column: e && e.loc ? e.loc.column : null
    };
  }
}

function parsePython(code, fileName = "file.py") {
  if (!fs.existsSync(PY_AST)) {
    return { ok: false, language: "python", error: "Python AST service is missing" };
  }
  try {
    const result = cp.spawnSync("python3", [PY_AST], {
      input: JSON.stringify({ code, file_name: fileName }),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    });
    if (result.error) return { ok: false, language: "python", error: result.error.message };
    let parsed;
    try { parsed = JSON.parse(result.stdout || "{}"); }
    catch (_) { return { ok: false, language: "python", error: "Invalid Python AST service response" }; }
    if (parsed.ok && parsed.ast && !parsed.snapshot) {
      const a = parsed.ast || {};
      const entities = [
        ...(a.functions || []).map(x => ({kind: x.async ? "async-function" : "function", name: x.name, location: {line:x.line ?? null, column:null}, params:x.params || []})),
        ...(a.classes || []).map(x => ({kind: "class", name: x.name, location: {line:x.line ?? null, column:null}})),
      ];
      const exports = (a.exports || []).map(x => ({type:"python-public", names:[x.name], location:{line:x.line ?? null, column:null}}));
      parsed.snapshot = {language:"python", entities, imports:a.imports || [], exports};
    }
    return parsed;
  } catch (e) {
    return { ok: false, language: "python", error: e.message || String(e) };
  }
}

async function parseCode(code, fileName = "file.txt") {
  const compilerLang = compilerLanguageForFile(fileName);
  if (compilerLang) return parseCompilerLanguage(code, fileName);
  const lang = languageForFile(fileName);
  if (lang === "python") return parsePython(code, fileName);
  if (lang === "javascript" || lang === "typescript") return await parseJavaScript(code, fileName);
  return { ok: false, language: "unknown", error: "Unsupported language" };
}

function semanticDiff(before, after) {
  const issues = [];
  if (!before || !after || !before.ok || !after.ok) return { ok: false, issues: ["Cannot diff invalid AST"] };

  const key = e => `${e.kind}|${e.name}`;
  const b = new Map((before.snapshot?.entities || []).map(e => [key(e), e]));
  const a = new Map((after.snapshot?.entities || []).map(e => [key(e), e]));

  for (const [k, e] of a) if (!b.has(k)) issues.push({ type: "added", entity: e });
  for (const [k, e] of b) if (!a.has(k)) issues.push({ type: "removed", entity: e });

  for (const [k, e] of a) {
    const old = b.get(k);
    if (!old) continue;
    if (JSON.stringify(old.params || []) !== JSON.stringify(e.params || [])) {
      issues.push({ type: "signature-changed", before: old, after: e });
    }
  }

  const beforeImports = new Set((before.snapshot?.imports || []).map(i => i.source));
  const afterImports = new Set((after.snapshot?.imports || []).map(i => i.source));
  for (const x of afterImports) if (!beforeImports.has(x)) issues.push({ type: "import-added", source: x });
  for (const x of beforeImports) if (!afterImports.has(x)) issues.push({ type: "import-removed", source: x });

  const beforeExports = JSON.stringify(before.snapshot?.exports || []);
  const afterExports = JSON.stringify(after.snapshot?.exports || []);
  if (beforeExports !== afterExports) issues.push({ type: "exports-changed" });

  return { ok: true, issues };
}

export { languageForFile, parseCode, parseJavaScript, parsePython, semanticDiff };


// V11: deep real-AST syntax gates for Java/C/C++/Go. These are parse/syntax checks only.
const V11_EXTRA_EXTS = new Set([".java",".c",".h",".cc",".cpp",".cxx",".hpp",".hh",".hxx",".go"]);
function languageForFileV8(fileName="") {
  return compilerLanguageForFile(fileName) || languageForFile(fileName);
}
async function parseCodeV8(code, fileName="file.txt") {
  const ext = path.extname(fileName).toLowerCase();
  if (V11_EXTRA_EXTS.has(ext)) return parseCompilerLanguage(code, fileName);
  return await parseCode(code, fileName);
}
const parseCodeV11 = parseCodeV8;
const parseCodeV10 = parseCodeV11;
const languageForFileV11 = languageForFileV8;
const languageForFileV10 = languageForFileV11;

export { parseCodeV8, languageForFileV8, parseCodeV11, languageForFileV11, parseCodeV10, languageForFileV10, parseCompilerLanguage };
