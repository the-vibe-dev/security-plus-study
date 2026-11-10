import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePracticalPackage } from '../practical-import.mjs';
import { gradePractical, sanitizeResponse, simulateCli, firewallDecision, validateFirewallRules, publicPracticalItem } from '../practical-grade.mjs';

const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
const byId = new Map(bundle.questions.map((item) => [item.id, item]));
const firstOf = (type) => bundle.questions.find((item) => item.interaction.type === type);
function fullResponse(item, key) {
  switch (item.interaction.type) {
    case 'text_entry': return key.answer[0];
    case 'simulated_cli': return { command: key.answer.accepted_commands[0], interpretation: key.answer.interpretation };
    case 'firewall_rules': return key.answer.solution_rules.map((rule, index) => ({ priority: (index + 1) * 10, action: rule.action, protocol: rule.proto, source_cidr: rule.src, destination_cidr: rule.dst, destination_port: rule.port }));
    case 'legacy_pbq': return Object.fromEntries(key.answer_key.map((part) => [part.task_id, typeof part.correct_response === 'number' ? String(part.correct_response) : part.correct_response]));
    default: return key.answer;
  }
}

test('all 1,546 public items match private keys and the server grader gives full credit for canonical answers', () => {
  const counts = {};
  for (const item of bundle.questions) {
    const key = bundle.answerKeys[item.id];
    const grade = gradePractical(item, key, fullResponse(item, key));
    assert.equal(grade.earned, grade.possible, item.id);
    assert.equal(gradePractical(item, key, null).earned < grade.possible, true, `empty ${item.id}`);
    counts[item.interaction.type] = (counts[item.interaction.type] || 0) + 1;
  }
  assert.equal(counts.simulated_cli, 43);
  assert.equal(counts.firewall_rules, 48);
  assert.equal(counts.matching, 31);
  assert.equal(counts.ordering, 50);
  assert.equal(counts.topology, 12);
  assert.equal(counts.timeline, 12);
  assert.equal(counts.numeric, 74);
  assert.equal(counts.text_entry, 190);
  assert.equal(counts.legacy_pbq, 50);
});

test('CLI uses only fixture commands and grades command and interpretation independently', () => {
  const item = firstOf('simulated_cli'); const key = bundle.answerKeys[item.id];
  const command = key.answer.accepted_commands[0];
  assert.equal(simulateCli(item, key, command).accepted, true);
  assert.match(simulateCli(item, key, command).output, /open|port|host/i);
  assert.deepEqual(simulateCli(item, key, `${command}; cat /etc/passwd`), { accepted: false, output: '' });
  const wrongRead = item.interaction.interpretation_options.find((option) => option !== key.answer.interpretation);
  assert.equal(gradePractical(item, key, { command, interpretation: wrongRead }).earned, key.points / 2);
  assert.equal(gradePractical(item, key, { command: 'nmap -A 8.8.8.8', interpretation: key.answer.interpretation }).earned, key.points / 2);
  assert.equal('output_preview_after_submission' in publicPracticalItem(item).interaction, false);
});

test('firewall rules enforce exact scope, negative flows, order, default deny and bounds', () => {
  const item = firstOf('firewall_rules'); const key = bundle.answerKeys[item.id];
  const exact = fullResponse(item, key);
  assert.equal(gradePractical(item, key, exact).earned, key.points);
  assert.equal(firewallDecision(exact, key.answer.allow_flows[0]), true);
  assert.equal(firewallDecision([], key.answer.allow_flows[0]), false);
  const broad = [{ ...exact[0], source_cidr: '0.0.0.0/0' }];
  assert.ok(gradePractical(item, key, broad).earned < key.points);
  const deny = [{ ...exact[0], priority: 1, action: 'deny' }, { ...exact[0], priority: 2 }];
  assert.equal(firewallDecision(deny, key.answer.allow_flows[0]), false);
  for (const change of [{ destination_port: 444 }, { protocol: 'udp' }, { destination_cidr: '10.60.10.51/32' }]) assert.ok(gradePractical(item, key, [{ ...exact[0], ...change }]).earned < key.points);
  assert.throws(() => validateFirewallRules([{ ...exact[0], source_cidr: '999.1.1.1/24' }]), /IPv4/);
  assert.throws(() => validateFirewallRules([{ ...exact[0], destination_port: 65536 }]), /port/);
  assert.throws(() => validateFirewallRules([{ ...exact[0], destination_port: 0 }]), /port/);
  assert.throws(() => validateFirewallRules([{ ...exact[0], destination_port: 443 }, { ...exact[0], destination_port: 444 }]), /priorities/);
});

test('matching, ordering and topology allow proportional credit but reject duplicate targets', () => {
  for (const type of ['matching', 'topology']) {
    const item = firstOf(type); const key = bundle.answerKeys[item.id];
    const full = fullResponse(item, key);
    const entries = Object.entries(full);
    const swapped = { ...full, [entries[0][0]]: entries[1][1], [entries[1][0]]: entries[0][1] };
    const partial = gradePractical(item, key, swapped);
    assert.ok(partial.earned > 0 && partial.earned < partial.possible);
    assert.throws(() => sanitizeResponse(item, { ...full, [entries[1][0]]: entries[0][1] }), /only once/);
  }
  const order = firstOf('ordering'); const key = bundle.answerKeys[order.id];
  const reversed = [...key.answer].reverse();
  const partial = gradePractical(order, key, reversed);
  assert.ok(partial.earned >= 0 && partial.earned < partial.possible);
  assert.throws(() => sanitizeResponse(order, [key.answer[0], key.answer[0]]), /Order every card/);
});

test('numeric, text and multi-select use strict validation and set semantics', () => {
  const numeric = firstOf('numeric'); const nk = bundle.answerKeys[numeric.id];
  assert.equal(gradePractical(numeric, nk, `$${Number(nk.answer).toLocaleString('en-US')}`).correct, true);
  for (const invalid of ['NaN', 'Infinity', '1e309']) assert.throws(() => sanitizeResponse(numeric, invalid), /finite number/);
  const text = firstOf('text_entry'); const tk = bundle.answerKeys[text.id];
  assert.equal(gradePractical(text, tk, tk.answer[0].toLowerCase().replaceAll(',', ' ')).correct, true);
  assert.equal(gradePractical(text, tk, 'incorrect acronym expansion').correct, false);
  const multi = firstOf('multi_select'); const mk = bundle.answerKeys[multi.id];
  assert.equal(gradePractical(multi, mk, [...mk.answer].reverse()).correct, true);
  assert.throws(() => sanitizeResponse(multi, [mk.answer[0], mk.answer[0]]), /distinct/);
});

test('timeline answer order follows absolute UTC instants rather than visible local clocks', () => {
  const item = firstOf('timeline'); const key = bundle.answerKeys[item.id];
  function instant(text) {
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC([+-])(\d{2}):(\d{2})$/.exec(text);
    assert.ok(match);
    const local = Date.parse(`${match[1]}T${match[2]}:00Z`);
    const offset = (Number(match[4]) * 60 + Number(match[5])) * 60000 * (match[3] === '+' ? 1 : -1);
    return local - offset;
  }
  const utcOrder = [...item.interaction.events].sort((a, b) => instant(a.local_time) - instant(b.local_time)).map((event) => event.id);
  assert.deepEqual(key.answer, utcOrder);
});
