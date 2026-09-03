import {
  VERSION, LIMITS, analyzeAndApply, buildIntegrity, createDiff, detectFileType,
  parsePatchBlocks, sha256, validateCode, verifyTransaction, finalizeTransaction,
} from './patchEngine.js';
import { auditCodeChange, AUDITOR_VERSION } from './codeAuditor.js';

const cancelled = new Set();

self.onmessage = async (event) => {
  const payload = event.data || {};
  const { id, original, patchText, fileName, fileType, mode, allowReviewApply } = payload;
  if (payload.type === 'cancel') { cancelled.add(id); return; }
  const fail = (message, extra = {}) => self.postMessage({ id, version: VERSION, ok: false, committed: false, message, ...extra });
  const isCancelled = () => cancelled.has(id);
  const checkpoint = () => { if (isCancelled()) throw new Error('CANCELLED'); };

  try {
    checkpoint();
    const source = String(original ?? '');
    const patchSource = String(patchText ?? '');
    if (!source.length) return fail('الكود الأصلي فارغ.');
    if (source.length > LIMITS.maxSourceChars) return fail('الكود الأصلي يتجاوز الحد الآمن.', { reason: 'source-size-limit' });
    if (patchSource.length > LIMITS.maxPatchChars) return fail('ملف الـPatch يتجاوز الحد الآمن.', { reason: 'patch-size-limit' });

    const parsed = parsePatchBlocks(patchSource);
    checkpoint();
    if (parsed.errors.length) return fail('تم إيقاف العملية بسبب أخطاء في Patch. لم يتم اعتماد أي تعديل.', { parsed, reason: 'patch-parse-failure' });
    if (!parsed.blocks.length) return fail('لم يتم العثور على كتل Patch صالحة.', { parsed, reason: 'no-patches' });

    // Full plan first. No external result is ever exposed as committed during planning.
    const originalHash = await sha256(source);
    checkpoint();
    const applied = await analyzeAndApply(source, parsed.blocks, { mode, atomic: true, allowReviewApply: allowReviewApply === true });
    checkpoint();
    if (!applied.ok || applied.rolledBack || applied.results.length !== parsed.blocks.length) {
      return self.postMessage({ id, version: VERSION, ok: false, committed: false,
        message: 'تم رفض العملية بالكامل: تعذر إثبات أمان جميع الـPatches.', parsed,
        applied: { ...applied, code: source, rolledBack: true }, code: source, validation: null, diff: [],
        integrity: { ok: true, originalHash, resultHash: originalHash, rolledBack: true },
      });
    }

    checkpoint();
    const verification = verifyTransaction(source, applied.code, parsed.blocks, applied.results, { mode, allowReviewApply: allowReviewApply === true });
    if (!verification.ok || verification.appliedCount !== parsed.blocks.length) {
      return fail('فشل Replay/Verification الكامل؛ تم رفض النتيجة وعدم اعتماد أي تعديل.', {
        parsed, applied: { ...applied, code: source, rolledBack: true, reason: verification.reason }, code: source,
        validation: null, diff: [], integrity: { ok: false, originalHash, resultHash: null, reason: verification.reason },
      });
    }

    checkpoint();
    const type = fileType === 'auto' ? detectFileType(fileName) : fileType;
    const validation = await validateCode(applied.code, type, fileName);
    checkpoint();
    const audit = await auditCodeChange({ before: source, after: applied.code, fileName, fileType: type, strict: true });
    checkpoint();
    if (!audit.ok) {
      return self.postMessage({ id, version: VERSION, ok: false, committed: false,
        message: 'تم رفض النتيجة: Code Auditor اكتشف مشكلة حرجة مؤكدة؛ تم تنفيذ Rollback كامل.', parsed,
        applied: { ...applied, code: source, rolledBack: true, reason: 'code-audit-blocked' }, code: source,
        validation, audit, diff: [], integrity: { ok: false, originalHash, resultHash: null, reason: 'code-audit-blocked' },
      });
    }
    if (!validation.ok) {
      return self.postMessage({ id, version: VERSION, ok: false, committed: false,
        message: 'تم رفض النتيجة لأن Validation فشل. الملف الأصلي محفوظ كما هو.', parsed,
        applied: { ...applied, code: source, rolledBack: true, reason: 'post-validation-failure' }, code: source,
        validation, diff: [], integrity: { ok: false, originalHash, resultHash: null, reason: 'post-validation-failure' },
      });
    }

    checkpoint();
    const integrity = await buildIntegrity(source, applied.code, parsed.blocks);
    checkpoint();
    const expectedFinalHash = await sha256(applied.code);
    const integrityOk = integrity.resultHash === expectedFinalHash;
    const decision = finalizeTransaction(source, applied, validation, integrityOk, verification.ok);
    if (!decision.committed) {
      return fail('فشل شرط الاعتماد النهائي؛ تم رفض العملية وإرجاع الملف الأصلي.', {
        parsed, applied: { ...applied, code: source, rolledBack: true, reason: decision.reason }, code: source,
        validation, diff: [], integrity: { ...integrity, ok: false, reason: decision.reason },
      });
    }

    checkpoint();
    const diff = createDiff(source, decision.code);
    self.postMessage({ id, version: VERSION, ok: true, committed: true,
      message: 'تم اجتياز Parse + Preflight + Apply + Verify + Replay + Validation + AST Validation + Code Audit + Integrity واعتماد النتيجة.',
      parsed, applied, code: decision.code, validation, audit, auditorVersion: AUDITOR_VERSION,
      verification: { ok: true, appliedCount: verification.appliedCount },
      integrity: { ...integrity, ok: true, appliedCount: verification.appliedCount }, diff,
    });
  } catch (error) {
    if (error?.message === 'CANCELLED') return;
    fail(`حدث خطأ داخلي؛ تم رفض العملية بالكامل: ${error?.message || error}`, { fatal: true, reason: 'internal-error' });
  } finally {
    cancelled.delete(id);
  }
};

self.onmessageerror = (event) => {
  self.postMessage({ ok: false, committed: false, message: 'تعذر قراءة رسالة Worker؛ تم رفض العملية.' });
};
