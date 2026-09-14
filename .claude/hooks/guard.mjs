/**
 * PreToolUse guard: the three rules of this repository that must not depend on
 * the agent remembering them.
 *
 * CLAUDE.md is guidance and competes for attention with everything else in it.
 * These three are hard lines, so they live here, where a tool call can actually
 * be stopped:
 *
 *   1. fixtures/ground-truth/RECORDING-SCRIPT.md is frozen. Reading it is fine;
 *      writing to it turns pre-registered expectations into rationalised ones.
 *   2. Changing a Gemini model id anywhere in src/ needs a human decision,
 *      because the free-tier quota and the verified pricing hang off it.
 *   3. Commits and pushes are the user's to make, by hand.
 *
 * Runs as `node .claude/hooks/guard.mjs` rather than a shell one-liner: the
 * project is on Windows, and node is the one interpreter guaranteed to be here.
 */
import { resolve } from 'node:path';

const FROZEN_FILE = 'fixtures/ground-truth/recording-script.md';

/** Any source file: each pipeline stage names its own model, so no single file owns the rule. */
const SOURCE_FILE_IN_BASH = /src\/[\w./-]*\.ts\b/i;
const isSourceFile = (target) => target.includes('/src/') && target.endsWith('.ts');

/** Shell fragments that write, as opposed to read. */
const MUTATION = /(^|[^>])>{1,2}[^>]|\btee\b|\bsed\b[^|]*-i|\brm\b|\bmv\b|\bcp\b|\btruncate\b/;
const GIT_WRITE = /\bgit\s+(commit|push)\b/;
const MODEL_ID = /gemini-\d/i;

function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/** Absolute, lowercased, forward-slashed - so Windows and POSIX spellings compare equal. */
function normalise(filePath, cwd) {
  return resolve(cwd, filePath).replaceAll('\\', '/').toLowerCase();
}

function readStdin() {
  return new Promise((resolveStdin) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolveStdin(raw));
    process.stdin.on('error', () => resolveStdin(''));
  });
}

const raw = await readStdin();

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  // A guard that cannot read its input must not take the session down with it:
  // fall through to the normal permission flow instead.
  process.exit(0);
}

const toolName = payload?.tool_name ?? '';
const input = payload?.tool_input ?? {};
const cwd = payload?.cwd ?? process.cwd();

if (toolName === 'Bash') {
  const command = String(input.command ?? '');

  if (GIT_WRITE.test(command)) {
    decide(
      'deny',
      'Commits and pushes in this repository are made by the user, by hand. ' +
        'Leave the working tree as it is and say what is ready to commit.',
    );
  }

  if (/recording-script\.md/i.test(command) && MUTATION.test(command)) {
    decide(
      'deny',
      'fixtures/ground-truth/RECORDING-SCRIPT.md is frozen: it holds expectations ' +
        'registered before the first pipeline run. Actual results belong in ' +
        'DELIVERY_NOTES.md. Reading the file is allowed.',
    );
  }

  if (SOURCE_FILE_IN_BASH.test(command) && MODEL_ID.test(command) && MUTATION.test(command)) {
    decide(
      'ask',
      'This writes a Gemini model id into a source file. The model is a user decision: ' +
        'free-tier quota is per model per day, and the verified pricing is tied to it.',
    );
  }

  process.exit(0);
}

if (toolName === 'Edit' || toolName === 'Write' || toolName === 'NotebookEdit') {
  const target = normalise(String(input.file_path ?? input.notebook_path ?? ''), cwd);

  if (target.endsWith(FROZEN_FILE)) {
    decide(
      'deny',
      'fixtures/ground-truth/RECORDING-SCRIPT.md is frozen: it holds expectations ' +
        'registered before the first pipeline run, and editing them after the fact ' +
        'turns them into rationalised results. Write actual outcomes to DELIVERY_NOTES.md.',
    );
  }

  if (isSourceFile(target)) {
    const written = `${input.new_string ?? ''}${input.content ?? ''}${input.new_source ?? ''}`;
    if (MODEL_ID.test(written)) {
      decide(
        'ask',
        'This writes a Gemini model id into a source file. The model is a user decision: ' +
          'free-tier quota is per model per day, and the verified pricing is tied to it.',
      );
    }
  }
}

process.exit(0);
