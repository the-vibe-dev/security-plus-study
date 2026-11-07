import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { parsePracticalPackage } from '../practical-import.mjs';

const content = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));

test('all eleven renderer modes have actual controls and safe evidence output', { timeout: 20000 }, async () => {
  const vite = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
  try {
    const { QuestionRenderer, assignUnique, moveCard } = await vite.ssrLoadModule('/src/QuestionRenderer.jsx');
    const expected = {
      single_select: 'practical-choice-list', multi_select: 'practical-choice-list', text_entry: 'practical-entry', numeric: 'practical-entry',
      matching: 'matching-board', ordering: 'ordering-list', timeline: 'ordering-list', topology: 'topology-canvas-wrap',
      simulated_cli: 'cli-terminal', firewall_rules: 'firewall-table', legacy_pbq: 'legacy-tasks',
    };
    for (const [type, marker] of Object.entries(expected)) {
      const item = content.questions.find((question) => question.interaction.type === type);
      const html = renderToStaticMarkup(React.createElement(QuestionRenderer, { item, response: null, onChange: () => {} }));
      assert.match(html, new RegExp(marker), `${type} renderer`);
      assert.match(html, /<h2>/, `${type} prompt`);
      assert.doesNotMatch(html, /answer_key|solution_rules|accepted_commands/, `${type} key leakage`);
    }
    const malicious = { ...content.questions.find((item) => item.interaction.type === 'text_entry'), prompt: '<img src=x onerror=alert(1)>' };
    const escaped = renderToStaticMarkup(React.createElement(QuestionRenderer, { item: malicious, response: '', onChange: () => {} }));
    assert.match(escaped, /&lt;img/);
    assert.doesNotMatch(escaped, /<img src=x/);
    const packet = content.questions.find((item) => item.topic === 'packet_analysis' && item.stimulus?.rows?.length);
    const evidence = renderToStaticMarkup(React.createElement(QuestionRenderer, { item: packet, response: null, onChange: () => {} }));
    assert.match(evidence, /evidence-table/);
    assert.match(evidence, /scope="row"/);
    assert.deepEqual(assignUnique({ a: 'x' }, 'b', 'x', true), { b: 'x' });
    assert.deepEqual(moveCard(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  } finally { await vite.close(); }
});

test('expected-answer feedback resolves identifiers to visible text after choice shuffling', async () => {
  const vite = await createServer({ root: new URL('..', import.meta.url).pathname, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  try {
    const { QuestionRenderer, expectedAnswerText } = await vite.ssrLoadModule('/src/QuestionRenderer.jsx');
    const selected = { id: 'shuffled', domain_id: 1, objective_id: '1.4', prompt: 'Choose a term.', stimulus: {}, interaction: { type: 'single_select', options: [{ id: 'D', text: 'Key Management Service' }, { id: 'A', text: 'Distractor' }] } };
    assert.equal(expectedAnswerText(selected, 'D'), 'Key Management Service');
    const html = renderToStaticMarkup(React.createElement(QuestionRenderer, { item: selected, response: 'D', onChange: () => {}, feedback: { earned: 1, possible: 1, correctAnswer: 'D' } }));
    assert.match(html, /<pre>Key Management Service<\/pre>/);
    assert.doesNotMatch(html, /<pre>D<\/pre>/);
    const multiple = { ...selected, interaction: { ...selected.interaction, type: 'multi_select' } };
    assert.deepEqual(expectedAnswerText(multiple, ['D', 'A']), ['Key Management Service', 'Distractor']);
    const events = { ...selected, stimulus: { events: [{ id: 'e1', message: 'Session opened' }] }, interaction: { type: 'multi_select', candidate_ids: ['e1'] } };
    assert.deepEqual(expectedAnswerText(events, ['e1']), ['e1: message: Session opened']);
    const order = { ...selected, interaction: { type: 'ordering', cards: [{ id: 's2', text: 'Verify' }, { id: 's1', text: 'Deploy' }] } };
    assert.deepEqual(expectedAnswerText(order, ['s1', 's2']), ['Deploy', 'Verify']);
    const matching = { ...selected, interaction: { type: 'matching', left: [{ id: 'l1', label: 'SSH' }], right: [{ id: 'r4', label: '22/TCP' }] } };
    assert.deepEqual(expectedAnswerText(matching, { l1: 'r4' }), ['SSH → 22/TCP']);
    const topology = { ...selected, interaction: { type: 'topology', slots: [{ id: 'slot', label: 'Management' }], elements: [{ id: 'device', label: 'Jump host' }] } };
    assert.deepEqual(expectedAnswerText(topology, { slot: 'device' }), ['Management → Jump host']);
  } finally { await vite.close(); }
});
