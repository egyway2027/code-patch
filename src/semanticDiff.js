import { parseCode, semanticDiff, languageForFile } from "./astEngine.js";

async function analyzeBeforeAfter(fileName, beforeCode, afterCode) {
  const before = await parseCode(beforeCode, fileName);
  const after = await parseCode(afterCode, fileName);
  if (!before.ok || !after.ok) {
    return {
      decision: "BLOCKED",
      before,
      after,
      diff: { ok: false, issues: ["AST validation failed"] }
    };
  }
  const diff = semanticDiff(before, after);
  return {
    decision: "SAFE",
    language: languageForFile(fileName),
    before,
    after,
    diff
  };
}

export { analyzeBeforeAfter };
