/**
 * The page: pick a file, watch the stages, read the guide.
 *
 * Everything shown here comes from the server's GuideDocument as-is. The page
 * decides nothing about the guide - in particular it never hides a step that
 * failed verification, because a product that admits what it could not confirm
 * is the entire argument being made.
 */
const el = (id) => document.getElementById(id);

const STAGE_ORDER = [
  ['ingestion', 'Ingestion'],
  ['observation', 'Observation'],
  ['reduce', 'Authoring'],
  ['phrasing', 'Phrasing'],
  ['frames', 'Frames'],
  ['grounding', 'Grounding'],
  ['assembly', 'Assembly'],
];

const STATUS_TEXT = {
  ok: 'Ready to follow — every step was confirmed against the recording.',
  ok_with_warnings: 'Ready, with warnings — read the notes before following it.',
  needs_clarification: 'Needs clarification — something in the recording is unresolved.',
  declined: 'Declined — no guide was produced from this recording.',
};

// The badge states what was established, not whether the step is right. Following
// A by hand showed the difference is not cosmetic: skipping the one step wearing
// the old "contradicted" badge silently dropped a column from the export.
// "not checked" is a fourth state, not a rewording - unavailable_reason has always
// separated "looked and was unsure" from "we never asked", and only the badge
// was throwing that away.
const BADGE_TEXT = {
  supported: 'confirmed on frames',
  contradicted: "frames don't show this",
  unclear: 'frames inconclusive',
  not_checked: 'not checked',
};

const UNCONFIRMED_NOTE =
  'Checked against two sampled frames only. The step may still be correct — ' +
  'read this as unconfirmed, not as wrong.';

function badgeState(verdict) {
  return verdict.unavailable_reason ? 'not_checked' : verdict.result;
}

const FLAG_TEXT = {
  silent_action: 'Done silently — easy to miss, and the result changes without it.',
  after_gap: 'The recording jumps just before this step.',
  conflict: 'The narration said something different here.',
};

let objectUrl = null;
let lastMarkdown = '';

function timestamp(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function resetStages() {
  const list = el('stages');
  list.replaceChildren();
  for (const [stage, label] of STAGE_ORDER) {
    const row = document.createElement('li');
    row.id = `stage-${stage}`;
    row.innerHTML =
      `<span class="name">${label}</span><span class="detail"></span><span class="time"></span>`;
    list.appendChild(row);
  }
  el('notes').replaceChildren();
}

function onPipelineEvent(event) {
  const row = el(`stage-${event.stage}`);

  if (event.type === 'stage_start' && row) {
    row.classList.add('running');
  } else if (event.type === 'stage_done' && row) {
    row.classList.remove('running');
    row.querySelector('.detail').textContent = event.detail;
    row.querySelector('.time').textContent = `${(event.wallMs / 1000).toFixed(1)}s`;
  } else if (event.type === 'stage_skipped' && row) {
    row.classList.add('skipped');
    row.querySelector('.detail').textContent = event.reason;
  } else if (event.type === 'retry' && row) {
    row.querySelector('.detail').textContent =
      `retrying in ${(event.delayMs / 1000).toFixed(1)}s — ${event.message}`;
  } else if (event.type === 'note') {
    const note = document.createElement('li');
    note.textContent = event.message;
    el('notes').appendChild(note);
  }
}

function renderSummary(doc, metrics) {
  const confirmed = doc.steps.filter((step) => step.verification.result === 'supported').length;
  const parts = [
    `<h2>${doc.title}</h2>`,
    `<p class="status ${doc.status}">${STATUS_TEXT[doc.status]}</p>`,
    `<p class="hint">In ${doc.app_label}.</p>`,
  ];

  if (doc.steps.length > 0) {
    parts.push(
      `<p><strong>${confirmed} of ${doc.steps.length} steps</strong> confirmed against frames ` +
        `from the recording (verified_ratio ${doc.verified_ratio.toFixed(2)}).</p>`,
    );
  }
  if (doc.decline_reason) {
    parts.push(`<p class="hint">Reason: <code>${doc.decline_reason}</code></p>`);
  }
  parts.push(
    `<p class="hint">From ${doc.source.filename}, ${doc.source.durationSec.toFixed(1)}s, ` +
      `sha256 ${doc.source.sha256.slice(0, 16)}… · built in ` +
      `${(metrics.totalWallMs / 1000).toFixed(1)}s</p>`,
  );

  el('summary').innerHTML = parts.join('');
}

function renderList(panelId, listId, items, render) {
  const panel = el(panelId);
  if (items.length === 0) {
    panel.hidden = true;
    return;
  }
  const list = el(listId);
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('li');
    row.innerHTML = render(item);
    list.appendChild(row);
  }
  panel.hidden = false;
}

function renderSteps(doc) {
  const list = el('steps');
  // A limitation, not a step: it lives outside the ordered list on purpose.
  const pre = el('precondition');
  pre.hidden = doc.steps.length === 0;
  if (doc.starting_state && doc.starting_state.trim()) {
    pre.querySelector('.precondition-title').textContent = 'Start from this state.';
    pre.querySelector('.precondition-body').textContent =
      `${doc.starting_state} This is what the recording showed before the first action, ` +
      'read off the screen rather than assumed.';
  }
  list.replaceChildren();

  const gapsAfter = (index) =>
    doc.missing_steps.filter((missing) => missing.after_step_index === index);

  const appendGap = (missing) => {
    const row = document.createElement('li');
    row.innerHTML =
      `<div class="gap"><strong>Something is missing here</strong> (${missing.severity}, around ` +
      `${timestamp(missing.t_gap)}). ${missing.what_changed} The recording does not show what ` +
      `caused this, and no step was invented to explain it.</div>`;
    list.appendChild(row);
  };

  for (const missing of gapsAfter(null)) appendGap(missing);

  for (const step of doc.steps) {
    const row = document.createElement('li');
    const verdict = step.verification;

    const flags = step.flags
      .map((flag) => `<li>${FLAG_TEXT[flag] ?? flag}</li>`)
      .concat(step.notes.map((note) => `<li>${note}</li>`))
      .join('');

    row.innerHTML = [
      '<div class="head">',
      `<span class="instruction"><strong>${step.index}.</strong> ${step.instruction}</span>`,
      `<button type="button" class="chip" data-seek="${step.t_start}">${step.timestamp_label}</button>`,
      `<span class="badge ${badgeState(verdict)}">${BADGE_TEXT[badgeState(verdict)]}</span>`,
      '</div>',
      verdict.result === 'contradicted'
        ? `<p class="unconfirmed-note">${UNCONFIRMED_NOTE}</p>`
        : '',
      flags ? `<ul class="flags">${flags}</ul>` : '',
      `<img src="${step.screenshot_url}" alt="Step ${step.index}" loading="lazy" />`,
      '<details><summary>How this step was checked</summary>',
      verdict.evidence_text ? `<p>Read from the screen: “${verdict.evidence_text}”</p>` : '',
      `<p>${verdict.reasoning}</p>`,
      verdict.unavailable_reason ? `<p>Not checked: ${verdict.unavailable_reason}</p>` : '',
      '</details>',
    ].join('');

    list.appendChild(row);
    for (const missing of gapsAfter(step.index)) appendGap(missing);
  }

  list.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-seek]');
    const player = el('player');
    if (!chip || player.hidden) return;
    player.currentTime = Number(chip.dataset.seek);
    player.play().catch(() => {});
  });
}

function renderMetrics(metrics) {
  const rows = metrics.stages
    .map(
      (stage) =>
        `<tr><td>${stage.stage}</td><td>${(stage.wallMs / 1000).toFixed(1)}s</td>` +
        `<td>${stage.apiCalls}</td><td>${stage.retries}</td><td>${stage.inputTokens}</td>` +
        `<td>${stage.outputTokens}</td><td>${stage.cacheHits}</td>` +
        `<td>${stage.costUsd > 0 ? `$${stage.costUsd.toFixed(4)}` : '—'}</td></tr>`,
    )
    .join('');

  const basis = metrics.stages.find((stage) => stage.pricingBasis)?.pricingBasis;

  el('metrics').innerHTML = [
    '<h2>What this run cost</h2>',
    '<table class="metrics"><thead><tr><th>Stage</th><th>Wall</th><th>Calls</th>',
    '<th>Retries</th><th>In</th><th>Out</th><th>Cached</th><th>Cost</th></tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    `<p><strong>$${metrics.totalCostUsd.toFixed(4)}</strong> over `,
    `${metrics.totalApiCalls} request(s) and ${metrics.totalRetries} retries`,
    metrics.timeToFirstStepMs
      ? `, first readable step at ${(metrics.timeToFirstStepMs / 1000).toFixed(1)}s`
      : '',
    '.</p>',
    basis ? `<p class="hint">Priced at ${basis}.</p>` : '',
    `<p class="hint">${metrics.pricing.note}</p>`,
    `<p class="hint">${metrics.pricing.source} — checked ${metrics.pricing.checkedOn}</p>`,
  ].join('');
}

function renderResult(payload) {
  const { document: doc, metrics, markdown } = payload;
  lastMarkdown = markdown;

  renderSummary(doc, metrics);
  renderList('questions', 'question-list', doc.clarifications, (item) => item.question);
  renderList('warnings', 'warning-list', doc.warnings, (item) => item);
  renderSteps(doc);
  renderList(
    'discarded',
    'discarded-list',
    doc.discarded,
    (item) =>
      `At ${timestamp(item.t_start)}: ${item.observation}<br /><span class="hint">Replaced by: ` +
      `${item.superseded_by_observation}</span>`,
  );
  renderMetrics(metrics);

  el('result').hidden = false;
}

async function run(file) {
  el('failure').hidden = true;
  el('result').hidden = true;
  el('progress').hidden = false;
  el('run').disabled = true;
  resetStages();

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  const player = el('player');
  player.src = objectUrl;
  player.hidden = false;

  const body = new FormData();
  body.append('video', file);

  try {
    const response = await fetch('/api/process', { method: 'POST', body });
    if (!response.ok || !response.body) {
      const detail = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(detail.message ?? 'The server refused the upload.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const line = chunk.split('\n').find((part) => part.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));

        if (event.type === 'done') renderResult(event);
        else if (event.type === 'error') throw new Error(`${event.code}: ${event.message}`);
        else onPipelineEvent(event);
      }
    }
  } catch (error) {
    el('failure-message').textContent = error.message;
    el('failure').hidden = false;
  } finally {
    el('run').disabled = false;
  }
}

const fileInput = el('file');
const dropzone = el('dropzone');

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  el('run').disabled = !file;
  el('dropzone-label').textContent = file ? file.name : 'Choose a recording, or drop one here';
});

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, () => dropzone.classList.remove('is-over'));
}
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  fileInput.files = event.dataTransfer.files;
  fileInput.dispatchEvent(new Event('change'));
});

el('upload-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (file) run(file);
});

el('copy-markdown').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lastMarkdown);
    el('copy-state').textContent = 'Copied.';
  } catch {
    el('copy-state').textContent = 'Copying was blocked — select the text instead.';
  }
});
