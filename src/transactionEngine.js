/**
 * V23 Core transaction coordinator.
 *
 * Invariant: prepare never mutates the filesystem. commit is the ONLY operation that writes.
 * A filesystem commit is atomic at the transaction level: every file is staged, verified,
 * then replaced; any failure triggers restoration from the on-disk snapshot.
 */
import { parsePatchBlocks, analyzeAndApply, verifyTransaction, verifyUntouched, validateCode, buildIntegrity, sha256, createDiff, detectFileType, LIMITS, createPatchPlan } from './patchEngine.js';
import { auditCodeChange } from './codeAuditor.js';
import { analyzeCrossFileImpact } from './impactAnalysis.js';
import { evaluateSecurityPolicy, evaluateImpactPolicy, normalizePolicy } from './policyEngine.js';
import { analyzeCodeIntelligence } from './analysisEngine.js';

const TRANSACTION_ID_RE = /^[a-f0-9]{64}$/i;

function reject(message, extra = {}) { return { ok:false, prepared:false, committed:false, rolledBack:false, message, ...extra }; }
function stablePlanSnapshot(p){ return JSON.parse(JSON.stringify(p)); }
function normalizeEntry(entry) {
  const fileName = String(entry?.fileName || 'source.txt');
  return { ...entry, fileName, content:String(entry?.content ?? entry?.original ?? ''), fileType:entry?.fileType && entry.fileType !== 'auto' ? entry.fileType : detectFileType(fileName) };
}

export async function prepareSingleFileTransaction(input, { policy, mode } = {}) {
  const p = normalizePolicy(policy), entry = normalizeEntry({ ...input, original:input?.original });
  const source = String(input?.original ?? input?.content ?? ''), patchText = String(input?.patchText ?? ''), fileName = entry.fileName, type = entry.fileType;
  if (!source.length) return reject('Original source is empty.');
  if (source.length > LIMITS.maxSourceChars) return reject('Source exceeds safety limit.');
  const parsed = parsePatchBlocks(patchText);
  if (parsed.errors.length || !parsed.blocks.length) return reject('Patch preflight failed.', { parsed });
  const originalHash = await sha256(source);
  if (input?.expectedOriginalHash && input.expectedOriginalHash !== originalHash) return reject('External mutation detected before patching.', { reason:'source-hash-mismatch', originalHash });
  const applied = await analyzeAndApply(source, parsed.blocks, { mode, atomic:true, allowReviewApply:false });
  if (!applied.ok || applied.rolledBack || applied.results.length !== parsed.blocks.length) return reject('Patch apply failed; rollback enforced.', { parsed, originalHash, applied:{ ...applied, code:source, rolledBack:true } });
  const verification = verifyTransaction(source, applied.code, parsed.blocks, applied.results, { mode });
  if (!verification.ok || verification.appliedCount !== parsed.blocks.length) return reject('Replay verification failed; rollback enforced.', { parsed, verification, code:source });
  const planned = createPatchPlan(source, parsed.blocks, { mode, allowReviewApply:false });
  if (!planned.ok || planned.code !== applied.code) return reject('Immutable patch plan verification failed.', { planned, code:source });
  const validation = await validateCode(applied.code, type, fileName);
  if (p.validation.requireParse && !validation.ok) return reject('Syntax/compiler validation failed; rollback enforced.', { validation, code:source });
  const audit = await auditCodeChange({ before:source, after:applied.code, fileName, fileType:type, strict:false });
  const intelligence = analyzeCodeIntelligence(fileName, applied.code);
  const securityPolicy = evaluateSecurityPolicy(audit, p);
  if (!securityPolicy.ok || (securityPolicy.review.length && p.validation.requireReviewApproval && !input?.reviewApproved)) return reject('Security policy blocked the transaction pending approval.', { audit, securityPolicy, code:source });
  const integrity = await buildIntegrity(source, applied.code, parsed.blocks);
  const integrityOk = integrity.resultHash === await sha256(applied.code);
  if (p.validation.requireIntegrity && !integrityOk) return reject('Integrity verification failed; rollback enforced.', { integrity, code:source });
  const finalVerification = verifyUntouched(source, applied.code, parsed.blocks, applied.results, { mode });
  if (p.validation.requireReplay && !finalVerification.ok) return reject('Untouched-region verification failed.', { verification:finalVerification, code:source });
  const patchPolicyHash = await sha256(JSON.stringify(p));
  const planSnapshot = stablePlanSnapshot({
    ...planned.plan,
    fileName,
    fileType:type,
    originalHash,
    resultHash:integrity.resultHash,
    patchSetHash:integrity.patchSetHash,
    policyHash:patchPolicyHash,
  });
  const planHash = await sha256(JSON.stringify(planSnapshot));
  return { ok:true, prepared:true, committed:false, rolledBack:false, fileName, fileType:type, filePath:input?.filePath || null, source, code:applied.code, parsed, applied, patchPlan:planSnapshot, planSnapshot, planHash, verification, validation, audit, intelligence, securityPolicy, integrity, diff:createDiff(source, applied.code), originalHash, resultHash:integrity.resultHash, expectedOriginalHash:input?.expectedOriginalHash || originalHash };
}

export async function prepareProjectTransaction(entries, { policy, mode, reviewApproved=false } = {}) {
  const p = normalizePolicy(policy), files = Array.isArray(entries) ? entries.map(normalizeEntry) : [];
  if (!files.length) return reject('Project is empty.');
  if (files.length > p.transaction.maxFiles) return reject(`Project exceeds ${p.transaction.maxFiles} files.`);
  const names = new Set();
  for (const f of files) { if (names.has(f.fileName)) return reject(`Duplicate project filename: ${f.fileName}.`); names.add(f.fileName); }
  const staged = [], before = [];
  for (const entry of files) {
    before.push({ fileName:entry.fileName, content:entry.content, fileType:entry.fileType, filePath:entry.filePath || null });
    const r = await prepareSingleFileTransaction(entry, { policy:p, mode });
    if (!r.ok) return { ...r, stage:staged, rolledBack:true };
    staged.push(r);
  }
  const after = files.map((f,i)=>({ fileName:f.fileName, content:staged[i].code, fileType:staged[i].fileType, filePath:f.filePath || null }));
  const impact = analyzeCrossFileImpact(before, after);
  const impactPolicy = evaluateImpactPolicy(impact, p);
  if (!impactPolicy.ok || (impactPolicy.review.length && p.validation.requireReviewApproval && !reviewApproved && !files.some(x=>x.reviewApproved))) return reject('Cross-file impact policy blocked the transaction pending approval.', { impact, impactPolicy, stage:staged, rolledBack:true });
  const planSnapshot = staged.map(x=>({fileName:x.fileName,filePath:x.filePath||null,fileType:x.fileType,originalHash:x.originalHash,resultHash:x.resultHash,planHash:x.planHash,patchPlan:x.planSnapshot}));
  const planSetHash = await sha256(JSON.stringify(planSnapshot));
  const transactionId = await sha256(JSON.stringify({ schemaVersion:2, files:before.map(x=>x.fileName), plans:planSnapshot, planSetHash }));
  return { ok:true, prepared:true, committed:false, rolledBack:false, transactionId, planHash:await sha256(JSON.stringify({schemaVersion:2, planSnapshot, planSetHash})), planSnapshot, planSetHash, results:staged.map(x=>({ fileName:x.fileName, fileType:x.fileType, filePath:x.filePath, originalContent:x.source, code:x.code, validation:x.validation, audit:x.audit, intelligence:x.intelligence, securityPolicy:x.securityPolicy, integrity:x.integrity, verification:x.verification, diff:x.diff, originalHash:x.originalHash, resultHash:x.resultHash, planHash:x.planHash, planSnapshot:x.planSnapshot, committed:false })), impact, impactPolicy, policy:p, message:'Transaction prepared and verified; filesystem has not been modified.' };
}

