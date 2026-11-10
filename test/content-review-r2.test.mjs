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
test('every selectable question and PBQ task offers at least four choices', () => {
  for (const q of bundle.questions) {
    const ui = q.interaction;
    if (['single_select', 'multi_select'].includes(ui.type) && ui.options) assert.ok(ui.options.length >= 4, q.id);
    if (ui.type === 'simulated_cli') assert.ok(ui.command_choices.length >= 4, q.id);
    if (ui.type === 'legacy_pbq') for (const task of ui.tasks) if (['single_select', 'multi_select'].includes(task.response_type)) assert.ok(task.options.length >= 4, `${q.id}/${task.id}`);
  }
});

test('concept scenarios use five choices and glossary recall has no choices', () => {
  const typed = bundle.questions.filter((q) => q.question_kind === 'multiple_choice' && q.interaction.type === 'text_entry');
  assert.equal(typed.length, 138);
  for (const q of typed) {
    assert.equal(q.interaction.options, undefined, q.id);
    assert.equal(gradePractical(q, key(q.id), key(q.id).correct_answer).correct, true, q.id);
  }
  const mttr = item('SPX-Q0119');
  assert.equal(gradePractical(mttr, key(mttr.id), 'Mean Time to Repair').correct, true);
  assert.equal(gradePractical(mttr, key(mttr.id), 'Mean Time to Recover').correct, false);
  for (let n = 1; n <= 43; n++) {
    const q = item(`SPX-MATCHING-${String(n).padStart(3, '0')}`);
    assert.equal(q.interaction.type, 'single_select', q.id);
    assert.equal(new Set(q.interaction.options).size, 5, q.id);
  }
});

test('port scenarios require a port decision without cross-choice clues', () => {
  for (const q of bundle.questions.filter((q) => q.topic === 'ports_protocols')) {
    assert.equal(q.interaction.type, 'single_select', q.id);
    assert.ok(q.interaction.options.every((option) => /^\d+\/(TCP|UDP)$/.test(option)), q.id);
    assert.equal(new Set(q.interaction.options.map((option) => option.split('/')[1])).size, 1, q.id);
  }
  assert.equal(key('SPX-PORTS_PRO-002').answer, '53/UDP');
  assert.equal(key('SPX-PORTS_PRO-004').answer, '53/TCP');
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

test('log scenarios show raw evidence and require correlation before drawing conclusions', () => {
  const logon = item('SPX-SIEM_LOGS-002');
  assert.match(logon.stimulus.evidence, /EventID=4624 LogonType=10/);
  assert.doesNotMatch(logon.stimulus.evidence, /success|interactive|Remote Desktop/i);
  assert.equal(key(logon.id).answer, 'Successful Remote Desktop logon');
  const sequence = item('SPX-SIEM_LOGS-019');
  assert.equal((sequence.stimulus.evidence.match(/EventID=4625.*198\.51\.100\.4/g) || []).length, 3);
  assert.match(sequence.stimulus.evidence, /EventID=4624.*198\.51\.100\.4/);
  assert.match(key(sequence.id).answer, /^Investigate possible unauthorized/);
  for (const id of ['SPX-SIEM_LOGS-020', 'SPX-SIEM_LOGS-021']) {
    const q = item(id);
    assert.equal(q.stimulus.events.length, 5);
    assert.ok(q.stimulus.events.every((row) => /^EventID=\d+/.test(row.message)));
    assert.equal(gradePractical(q, key(id), ['e0', 'e2']).correct, false, id);
  }
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
