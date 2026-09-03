import assert from 'node:assert/strict';
import { AUDITOR_VERSION, auditCodeChange } from './codeAuditor.js';

assert.equal(AUDITOR_VERSION, '11.0.0');

// --- False positives that a whole-text regex scanner would wrongly flag/block. ---
// "eval(" appearing inside a string literal is not a call — must not fire.
let fp1 = auditCodeChange({ before: '', after: 'const help = "Please dont eval(input) manually";\n', fileName: 'x.js', fileType: 'javascript' });
assert.equal(fp1.findings.length, 0);
assert.equal(fp1.decision, 'SAFE');

// A placeholder-looking value on a secret-shaped key must not fire.
let fp2 = auditCodeChange({ before: '', after: 'const apiKey = "unit-test-placeholder-not-real";\n', fileName: 'x.js', fileType: 'javascript' });
assert.equal(fp2.findings.length, 0);

// A comment mentioning eval() is not code at all (parser strips comments from the AST).
let fp3 = auditCodeChange({ before: '', after: '// call eval(x) is dangerous, don\'t do it\nconst y = 1;\n', fileName: 'x.js', fileType: 'javascript' });
assert.equal(fp3.findings.length, 0);

// --- True positives: real AST shapes must still be caught. ---
let tp1 = auditCodeChange({ before: '', after: 'eval(userInput);\n', fileName: 'x.js', fileType: 'javascript' });
assert.ok(tp1.findings.some(f => f.code === 'JS-EVAL'));
assert.equal(tp1.decision, 'WARNING'); // informational by default, never blocks
assert.equal(tp1.ok, true);

let tp2 = auditCodeChange({ before: '', after: 'const apiKey = "sk-liveAbCdEf1234567890";\n', fileName: 'x.js', fileType: 'javascript' });
assert.ok(tp2.findings.some(f => f.code === 'HARDCODED-SECRET'));

let tp3 = auditCodeChange({ before: '', after: 'el.innerHTML = userHtml;\n', fileName: 'x.js', fileType: 'javascript' });
assert.ok(tp3.findings.some(f => f.code === 'DOM-INNERHTML'));

let tp4 = auditCodeChange({ before: '', after: 'const el = <div dangerouslySetInnerHTML={{__html: x}} />;\n', fileName: 'x.jsx', fileType: 'jsx' });
assert.ok(tp4.findings.some(f => f.code === 'REACT-RAW-HTML'));

let tp5 = auditCodeChange({ before: '', after: 'const q = "SELECT * FROM users WHERE id=" + userId;\n', fileName: 'x.js', fileType: 'javascript' });
assert.ok(tp5.findings.some(f => f.code === 'SQL-CONCAT'));

// --- Strict mode: only an explicit opt-in turns a critical finding into a hard block. ---
let strictOn = auditCodeChange({ before: '', after: 'eval(x);\n', fileName: 'x.js', fileType: 'javascript', strict: true });
assert.equal(strictOn.decision, 'BLOCKED');
assert.equal(strictOn.ok, false);
let strictOff = auditCodeChange({ before: '', after: 'eval(x);\n', fileName: 'x.js', fileType: 'javascript', strict: false });
assert.equal(strictOff.decision, 'WARNING');
assert.equal(strictOff.ok, true);

// --- Change summary is reused from patchEngine.summarizeChanges, not reimplemented. ---
let cs = auditCodeChange({ before: 'function keep(){}\nfunction old(){}\n', after: 'function keep(){}\nfunction old(){return 1;}\nfunction added(){}\n', fileName: 'x.js', fileType: 'javascript' });
assert.equal(cs.changes.kind, 'semantic');
assert.ok(cs.changes.added.some(t => t.includes('added')));
assert.ok(cs.changes.changed.some(t => t.includes('old')));

// --- Non-JS types: no security scan is claimed; changes still reported via the line-based fallback. ---
let py = auditCodeChange({ before: 'a=1\n', after: 'a=1\nb=2\n', fileName: 'x.py', fileType: 'python' });
assert.equal(py.scanned, true);
assert.equal(py.findings.length, 0);
assert.equal(py.changes.kind, 'lines');

console.log('codeAuditor tests: PASS');
