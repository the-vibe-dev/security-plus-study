import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { parsePracticalPackage } from '../practical-import.mjs';
import { gradePractical, publicPracticalItem } from '../practical-grade.mjs';

// Second content review: answer-revealing cues, option counts, log readability and diagram rendering.
const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
const item = (id) => bundle.questions.find((q) => q.id === id);
const key = (id) => bundle.answerKeys[id];
const initials = (text) => text.split(/[\s/\-,]+/).filter(Boolean).map((word) => word.toUpperCase() === word && word.length > 1 ? word.toLowerCase() : word.toLowerCase().startsWith('ex') ? 'ex' : word[0].toLowerCase()).join('');
const spells = (acronym, text) => { const letters = acronym.replace(/[^A-Z0-9]/g, '').toLowerCase().replace('2', 'c'); let from = 0; for (const ch of letters) { const at = initials(text).indexOf(ch, from); if (at < 0) return false; from = at + 1; } return true; };

test('every selectable question and PBQ task offers at least four choices', () => {
  for (const q of bundle.questions) {
    const ui = q.interaction;
    if (['single_select', 'multi_select'].includes(ui.type) && ui.options) assert.ok(ui.options.length >= 4, q.id);
    if (ui.type === 'simulated_cli') assert.ok(ui.command_choices.length >= 4, q.id);
    if (ui.type === 'legacy_pbq') for (const task of ui.tasks) if (['single_select', 'multi_select'].includes(task.response_type)) assert.ok(task.options.length >= 4, `${q.id}/${task.id}`);
  }
});

test('acronym expansion questions use distractors that match the abbreviation letters', () => {
  const acronymItems = bundle.questions.filter((q) => q.question_kind === 'multiple_choice' && /abbreviates a term as|what does KMS stand for/.test(q.prompt));
  assert.ok(acronymItems.length >= 130);
  for (const q of acronymItems) {
    const match = /term as ([A-Za-z0-9/]+)[.?]/.exec(q.prompt) || /AWS ([A-Z]+),/.exec(q.prompt);
    if (!match) continue; // e.g. "SOC 2", a report type rather than an initialism
    const acronym = match[1];
    const spelled = q.interaction.options.filter((option) => spells(acronym, option.text)).length;
    assert.ok(spelled >= 3, `${q.id} ${acronym}: only ${spelled} options match the letters`);
    assert.equal(new Set(q.interaction.options.map((option) => option.text)).size, 4, q.id);
  }
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'matching' && /decoys/.test(q.prompt))) {
    assert.equal(q.interaction.right.length, q.interaction.left.length + 2, q.id);
    assert.ok(new Set(Object.values(key(q.id).answer)).size === q.interaction.left.length, q.id);
    assert.match(key(q.id).explanation, /Decoys:/);
  }
});

test('numeric formula hints stay out of the displayed evidence and list-type context renders as a list', { timeout: 20000 }, async () => {
  const vite = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  try {
    const { QuestionRenderer } = await vite.ssrLoadModule('/src/QuestionRenderer.jsx');
    const render = (q, response = null) => renderToStaticMarkup(React.createElement(QuestionRenderer, { item: publicPracticalItem(q), response, onChange: () => {} }));
    const sle = render(item('SPX-RISK_RECO-001'));
    assert.doesNotMatch(sle, /SLE = AV/);
    assert.doesNotMatch(sle, /formula/i);
    const ordering = render(item('SPX-IN_ORDER-002'));
    assert.match(ordering, /<ol class="evidence-list">/);
    assert.doesNotMatch(ordering, /\["Document access requirement/);
    assert.match(ordering, /Already completed, in order/);
    assert.match(ordering, /Runbook/);
    const topology = render(item('SPX-NETWORK_D-004'), key('SPX-NETWORK_D-004').answer);
    assert.match(topology, /topology-zone/);
    assert.match(topology, /topology-link traffic/);
    assert.match(topology, /topology-link admin/);
    assert.match(topology, /topology-link monitor/);
    assert.match(topology, /topology-legend/);
    assert.match(topology, /Plant \/ OT network/);
    assert.doesNotMatch(render(item('SPX-CLI_TOOLS-001')), /Authorized fictional lab.*Authorized fictional lab/s);
  } finally { await vite.close(); }
});

test('Windows log evidence names the event meaning instead of relying on memorized IDs', () => {
  for (const id of ['SPX-SIEM_LOGS-001', 'SPX-SIEM_LOGS-002', 'SPX-SIEM_LOGS-003', 'SPX-SIEM_LOGS-004', 'SPX-SIEM_LOGS-014', 'SPX-SIEM_LOGS-015']) assert.match(item(id).stimulus.evidence, /EventID=\d{4} \([A-Z][^)]+\)/, id);
  for (const id of ['SPX-SIEM_LOGS-019', 'SPX-SIEM_LOGS-020', 'SPX-SIEM_LOGS-021']) for (const event of item(id).stimulus.events.slice(0, 2)) assert.match(event.message, /^\d{4} \(/, `${id} ${event.id}`);
  assert.match(item('SPX-CLI_TOOLS-033').prompt, /event ID 4625/);
});

test('timeline items test timestamp normalization and say so; runbook ordering items carry their context', () => {
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'timeline')) {
    assert.match(q.prompt, /Normalize every timestamp to UTC/);
    assert.equal(q.objective_id, '4.9');
    assert.equal(q.subtopic, 'timeline_reconstruction');
    assert.match(key(q.id).explanation, /Normalized sequence: \d{2}:\d{2} UTC/);
  }
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'ordering')) assert.ok(q.stimulus.runbook, q.id);
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'ordering' && q.stimulus.prior_steps_complete)) assert.match(q.prompt, /^Runbook: .*Already completed/);
});

test('RPO decisions offer four options and still grade the keyed answer', () => {
  for (let n = 41; n <= 52; n++) {
    const q = item(`SPX-RISK_RECO-${n.toString().padStart(3, '0')}`);
    assert.equal(q.interaction.options.length, 4);
    assert.equal(gradePractical(q, key(q.id), key(q.id).answer).correct, true);
    assert.equal(gradePractical(q, key(q.id), 'Cannot be determined: RPO is measured by restoration time, not data age').correct, false);
  }
});
