import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePracticalPackage } from '../practical-import.mjs';
import { gradePractical, simulateCli } from '../practical-grade.mjs';

// Study-bank wording, accepted answers and interaction contracts.
const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
const item = (id) => bundle.questions.find((q) => q.id === id);
const key = (id) => bundle.answerKeys[id];

test('CLI fixtures accept only valid command forms and the unit name the prompt uses', () => {
  const ip = item('SPX-CLI_TOOLS-008'), ipKey = key('SPX-CLI_TOOLS-008');
  assert.equal(simulateCli(ip, ipKey, 'ip -4 addr show').accepted, true);
  assert.equal(simulateCli(ip, ipKey, 'ip addr show -4').accepted, false);
  const journal = item('SPX-CLI_TOOLS-016'), journalKey = key('SPX-CLI_TOOLS-016');
  assert.equal(simulateCli(journal, journalKey, 'journalctl -u ssh.service -n 20').accepted, true);
  assert.equal(simulateCli(item('SPX-CLI_TOOLS-023'), key('SPX-CLI_TOOLS-023'), 'iptables -S INPUT').accepted, true);
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'simulated_cli' && q.interaction.shell !== 'bash')) assert.doesNotMatch(q.stimulus.supported_syntax, /Unix/);
});

test('independent runbook steps are accepted in either order and no ordering item is displayed pre-solved', () => {
  const onboarding = item('SPX-IN_ORDER-033'), onboardingKey = key('SPX-IN_ORDER-033');
  assert.equal(gradePractical(onboarding, onboardingKey, ['s0', 's2', 's3', 's1', 's4', 's5']).correct, true);
  assert.equal(gradePractical(onboarding, onboardingKey, ['s4', 's0', 's1', 's2', 's3', 's5']).correct, false);
  assert.equal(gradePractical(item('SPX-IN_ORDER-001'), key('SPX-IN_ORDER-001'), ['s0', 's1', 's3', 's2', 's4', 's5', 's6']).correct, true);
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'ordering')) assert.notDeepEqual(q.interaction.cards.map((card) => card.id), key(q.id).answer, q.id);
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'timeline')) assert.notDeepEqual(q.interaction.events.map((event) => event.id), key(q.id).answer, q.id);
});

test('acronym drills accept common SY0-701 expansion variants', () => {
  for (const [id, answer] of [['SPX-ACRONYM_R-052', 'Mean time to recover'], ['SPX-ACRONYM_R-011', 'Key Management Service'], ['SPX-ACRONYM_R-013', 'Rivest, Shamir, and Adleman'], ['SPX-ACRONYM_R-030', 'Software-Defined Network']]) {
    assert.equal(gradePractical(item(id), key(id), answer).correct, true, id);
  }
  assert.equal(gradePractical(item('SPX-ACRONYM_R-011'), key('SPX-ACRONYM_R-011'), 'Key Management System').correct, false);
  assert.match(item('SPX-ACRONYM_R-039').prompt, /incident response/);
});

test('legacy PBQ option identifiers do not reveal the keyed answer', () => {
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'legacy_pbq')) {
    for (const task of q.interaction.tasks) for (const option of task.options || []) assert.match(option.id, /^o\d+$/, `${q.id}/${task.id}`);
  }
});

test('expansion questions use numeric port options and specific rationales', () => {
  for (const q of bundle.questions.filter((q) => q.origin === 'securityplus-practical-expansion-v1' && q.question_kind === 'multiple_choice')) {
    const k = key(q.id);
    for (const option of q.interaction.options || []) {
      if (/^\d+\/(TCP|UDP)/.test(option.text)) assert.doesNotMatch(option.text, /\(/, q.id);
    }
    for (const text of Object.values(k.rationales)) assert.doesNotMatch(text, /does not satisfy the requirement/, q.id);
    assert.ok(k.explanation.length >= 60, q.id);
    assert.doesNotMatch(k.explanation, /^\? stands for/, q.id);
    assert.equal(q.domain_id, Number(q.objective_id[0]), q.id);
  }
});

test('reworded items match their keys', () => {
  assert.match(item('SPX-WIRELESS_-004').stimulus.evidence, /WPA2 clients without protected management frames/);
  assert.match(item('SPX-SIEM_LOGS-022').prompt, /together confirm a successful SSH session/);
  assert.equal(key('SPX-CONTROLS_-014').answer, 'Memorandum of understanding');
  assert.ok(item('SPX-CONTROLS_-014').interaction.options.includes('Memorandum of understanding'));
  assert.notDeepEqual(item('SPX-CONTROLS_-028').interaction.left, item('SPX-CONTROLS_-019').interaction.left);
  assert.equal(key('SPX-RISK_RECO-011').answer, 0.25);
  assert.equal(key('SPX-RISK_RECO-036').answer, 10000);
});

test('all numeric loss and reliability answers follow the quantities stated in their prompts', () => {
  const numbers = (text) => [...text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map(([value]) => Number(value.replaceAll(',', '')));
  const numeric = bundle.questions.filter((q) => q.interaction.type === 'numeric');
  assert.equal(numeric.length, 74);
  for (const q of numeric) {
    const [a, b, c] = numbers(q.prompt);
    let expected;
    if (/Calculate the SLE/.test(q.prompt)) expected = a * b / 100;
    else if (/Incident records show/.test(q.prompt)) expected = a / b;
    else if (/What exposure factor/.test(q.prompt)) expected = b / a * 100;
    else if (/Compute ALE/.test(q.prompt)) expected = a * b / 100 * c;
    else if (/annual net benefit/.test(q.prompt)) expected = a - c - b;
    else if (/residual ALE/.test(q.prompt)) expected = a * c;
    else if (/restoration exceed/.test(q.prompt)) expected = Math.max(0, a - b);
    else if (/maintenance log records/.test(q.prompt)) expected = b / a;
    else if (/fleet recorded/.test(q.prompt)) expected = a / b;
    else assert.fail(`Unreviewed numeric formula: ${q.id}`);
    assert.ok(Math.abs(key(q.id).answer - expected) < 0.000001, q.id);
    assert.equal(gradePractical(q, key(q.id), String(expected)).correct, true, q.id);
    assert.equal(gradePractical(q, key(q.id), String(expected + 1)).correct, false, q.id);
  }
});

test('short runbooks accept the same remaining independent actions as their full runbooks', () => {
  for (let n = 1; n < 50; n += 2) {
    const full = item(`SPX-IN_ORDER-${String(n).padStart(3, '0')}`);
    const short = item(`SPX-IN_ORDER-${String(n + 1).padStart(3, '0')}`);
    const labels = Object.fromEntries(full.interaction.cards.map((card) => [card.id, card.text]));
    const ids = Object.fromEntries(short.interaction.cards.map((card) => [card.text, card.id]));
    for (const order of key(full.id).valid_orders || [key(full.id).answer]) {
      const remaining = order.filter((id) => labels[id] in ids).map((id) => ids[labels[id]]);
      assert.equal(gradePractical(short, key(short.id), remaining).correct, true, `${full.id} -> ${short.id}`);
    }
  }
});

test('SSH session evidence correlates host, process, account and timestamps', () => {
  const events = item('SPX-SIEM_LOGS-022').stimulus.events;
  assert.equal(events[1].host, events[2].host);
  assert.equal(events[1].process, events[2].process);
  assert.notEqual(events[0].process, events[1].process);
  assert.ok(Date.parse(events[2].time) - Date.parse(events[1].time) <= 1000);
  assert.match(events[2].message, /sshd:session/);
  assert.match(item('SPX-PACKET_AN-022').prompt, /ICMP destination-port-unreachable/);
});
