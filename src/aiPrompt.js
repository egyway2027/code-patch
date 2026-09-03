/**
 * The text below is copied verbatim by the "AI Prompt" button in the UI. It is written
 * to be pasted into any AI assistant's chat, so that assistant can generate patches this
 * tool will accept on the first try. Keep it self-contained: an assistant reading only
 * this text (no other context about the tool) must be able to produce a valid patch.
 */
export const AI_PROMPT_VERSION = "1.0.0";

export const AI_PROMPT = `You are producing input for "Code Patcher", a fail-closed, transactional code-patching tool. It never executes your code — it only parses, matches, and text-substitutes. Follow this spec exactly; output that doesn't match it is rejected in full, with nothing applied.

## What to output
Output ONLY one or more SEARCH/REPLACE blocks, in this exact format:

<<<<<<< SEARCH [PATCH: short-unique-id]
exact text currently in the file
=======
the new text that should replace it
>>>>>>> REPLACE

- Output nothing else: no prose before/after, no markdown code fences around the blocks, no explanations. The tool treats ANY text outside a block — even a single stray line — as a fatal error and rejects the entire submission, applying nothing.
- You may output multiple blocks back-to-back (blank lines between them are fine). All blocks are applied together as one atomic transaction: either every block applies, or none do. There is no partial application.
- Never resend the whole file. Send only the minimal SEARCH/REPLACE pairs needed for the requested change.

## The id
- \`[PATCH: short-unique-id]\` is optional but strongly recommended. Give each block a short, descriptive, kebab-case id describing the change's intent, e.g. \`add-null-check\`, \`fix-import-path\`, \`rename-helper\`.
- Each id must be unique among the blocks you output in the same submission. It cannot contain a newline or square brackets.

## The SEARCH side — this is the part that most often gets rejected
- SEARCH must be copied EXACTLY, character-for-character, from the source file you were given — same whitespace, same indentation, same quote characters, same capitalization. Do not "clean up" or reformat it. (Line-ending style, CRLF vs LF, is the one exception — that alone will not break a match.)
- SEARCH must match the target location in the file UNIQUELY — exactly once. If your SEARCH text appears zero times, the patch is rejected as "not found." If it appears more than once, it is rejected as "ambiguous" — nothing is applied, even to the correct occurrence.
  - If the line(s) you want to change are short or repeated elsewhere in the file (e.g. \`return null;\`, \`}\`, a common variable name), include a few extra lines of surrounding context above and/or below so the block becomes unique. Include only as much context as is needed for uniqueness — not the whole function or file.
- SEARCH must never be empty.
- Never let SEARCH and REPLACE ranges from different blocks overlap the same text.

## The REPLACE side
- REPLACE is the exact text that should end up in the file in place of SEARCH. It may be empty (to delete the matched text).
- REPLACE must never contain a line that is by itself \`=======\` (six or seven equals signs) — that exact line is reserved as the block separator. If your intended replacement genuinely needs a line like that, split the change into a different shape or say so instead of emitting it.

## Worked example
Given this file:
\`\`\`
function greet(name) {
  return "Hello, " + name;
}

function farewell(name) {
  return "Bye, " + name;
}
\`\`\`
To fix a typo in the greeting only, output:

<<<<<<< SEARCH [PATCH: fix-greeting-typo]
  return "Hello, " + name;
=======
  return \`Hello, \${name}!\`;
>>>>>>> REPLACE

Not the whole file, not the whole function — just the changed line(s), with just enough surrounding text to be unique (here, the leading two-space indent plus the exact original code was already unique on its own).

## What happens after you output a patch
The tool will, in order: parse your blocks; locate each SEARCH range uniquely in the current file; apply all replacements; replay the same blocks against the original from scratch and confirm the replay matches; validate the resulting file's syntax; run a non-blocking, informational change/security summary; compute integrity hashes; and only then commit. If any step fails, the original file is returned completely unchanged — there is no partial or "best effort" result.

Validation strength depends on file type: JavaScript, TypeScript, JSX, TSX, JSON, and JSONC get a real AST/parser syntax check, so any real syntax error in your REPLACE text for those types will be caught precisely. Python, HTML, XML, and CSS get a conservative structural check (balanced brackets/tags/indentation) rather than a full compiler, so prioritize getting those exactly right yourself.

## Checklist before you answer
- [ ] Output contains only SEARCH/REPLACE blocks — nothing else, no code fences, no commentary.
- [ ] Every SEARCH string is copied verbatim from the given source, not retyped from memory.
- [ ] Every SEARCH string is unique in the file (add context if it might repeat).
- [ ] No block's REPLACE contains a standalone \`=======\` line.
- [ ] Each block has a short, unique, descriptive id.
- [ ] You sent only the changed snippets, not the whole file.`;
