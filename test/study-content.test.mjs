import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePracticalPackage } from '../practical-import.mjs';
import { gradePractical, publicPracticalItem, simulateCli } from '../practical-grade.mjs';
import { commandTokens } from '../command-match.mjs';
import { importQuestionFile } from '../import.mjs';
const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip', import.meta.url)));
const item = (id) => bundle.questions.find((q) => q.id === id);
const key = (id) => bundle.answerKeys[id];

test('Unix flags and quoted argument boundaries retain meaning in both grading and simulation', () => {
  for (const [id, good, bad] of [['SPX-CLI_TOOLS-014', 'curl --head "https://portal.example.test"', 'curl -i https://portal.example.test'], ['SPX-CLI_TOOLS-001', 'nmap -sV -p 22,443 192.0.2.10', 'nmap -sv -p 22,443 192.0.2.10']]) {
    const q = item(id), k = key(id);
    assert.equal(simulateCli(q, k, good).accepted, true);
    assert.equal(simulateCli(q, k, bad).accepted, false);
    assert.equal(gradePractical(q, k, { command: bad, interpretation: k.answer.interpretation }).earned, k.points / 2);
  }
  assert.notDeepEqual(commandTokens('tool "two words"'), commandTokens('tool two words'));
  assert.equal(commandTokens('tool "unterminated'), null);
  assert.equal(simulateCli(item('SPX-CLI_TOOLS-014'), key('SPX-CLI_TOOLS-014'), 'curl I https portal example test').accepted, false);
});
test('disclosed CLI choices cover supported equivalent forms without exposing interpretations', () => {
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'simulated_cli')) {
    const pub = publicPracticalItem(q);
    assert.ok(pub.interaction.command_choices.length);
    assert.equal('output_preview_after_submission' in pub.interaction, false);
    // Menus list every accepted form plus at least two wrong or out-of-scope forms, so the menu alone cannot reveal the answer.
    const accepted = pub.interaction.command_choices.filter((form) => simulateCli(q, key(q.id), form).accepted);
    for (const form of key(q.id).answer.accepted_commands) assert.ok(pub.interaction.command_choices.includes(form), `${q.id} ${form}`);
    assert.ok(pub.interaction.command_choices.length >= 4, q.id);
    assert.ok(pub.interaction.command_choices.length - accepted.length >= 2, q.id);
  }
  assert.match(item('SPX-CLI_TOOLS-013').prompt, /\/tmp\/staging.pem/);
  assert.match(item('SPX-CLI_TOOLS-016').prompt, /ssh.service.*20/);
  assert.match(item('SPX-CLI_TOOLS-018').prompt, /either direction/);
  assert.doesNotMatch(item('SPX-CLI_TOOLS-034').prompt, /enabled/);
  assert.match(key('SPX-CLI_TOOLS-026').answer.interpretation, /authorizes no sending hosts.*Fail/);
});
test('accepted acronym aliases and independent risk-estimation orders receive full credit', () => {
  for (const [id, answer] of [['SPX-ACRONYM_R-006', 'Certification Authority'], ['SPX-ACRONYM_R-015', 'Keyed-Hash Message Authentication Code'], ['SPX-ACRONYM_R-001', 'Authentication, Authorisation, Accounting'], ['SPX-ACRONYM_R-039', 'Security Operations Centre']]) assert.equal(gradePractical(item(id), key(id), answer).correct, true);
  assert.equal(gradePractical(item('SPX-IN_ORDER-041'), key('SPX-IN_ORDER-041'), ['s0','s3','s1','s2','s4','s5']).correct, true);
  assert.equal(gradePractical(item('SPX-IN_ORDER-041'), key('SPX-IN_ORDER-041'), ['s4','s0','s3','s1','s2','s5']).correct, false);
});
test('scenarios distinguish permissions, EKU, issuer revocation and elapsed repair duration', () => {
  assert.match(item('SPX-IDENTITY_-016').stimulus.evidence, /read-only.*member of a write-privileged/);
  assert.match(item('SPX-PKI_CRYPT-014').stimulus.evidence, /TLS Web Server Authentication[\s\S]*TLS Web Client Authentication/);
  assert.match(key('SPX-IDENTITY_-015').answer, /issuing authorization server/);
  for (const id of ['SPX-SIEM_LOGS-020','SPX-SIEM_LOGS-021']) {
    const events = item(id).stimulus.events.slice(0,2);
    assert.ok(events.every((event) => event.host && event.account_sid && event.time));
    assert.equal(events[0].account_sid, events[1].account_sid);
  }
  for (let n = 65; n <= 76; n++) {
    const q = item(`SPX-RISK_RECO-${n.toString().padStart(3,'0')}`);
    assert.doesNotMatch(q.prompt, /technician-hours/);
    assert.match(q.prompt, /elapsed repair hours/);
  }
});
test('architecture diagrams draw typed links and firewall tasks permit incorrect rule sets', () => {
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'topology')) {
    const ids = new Set([...q.interaction.slots.map((slot) => slot.id), ...q.stimulus.anchors.map((anchor) => anchor.id)]);
    assert.ok(q.stimulus.zones.length >= 4 && q.stimulus.anchors.length >= 1 && q.stimulus.connections.length >= 5, q.id);
    for (const edge of q.stimulus.connections) { assert.ok(ids.has(edge.from) && ids.has(edge.to), `${q.id} ${edge.from}->${edge.to}`); assert.ok(['traffic', 'admin', 'monitor'].includes(edge.kind), q.id); }
    for (const slot of q.interaction.slots) assert.ok(q.stimulus.zones.some((zone) => slot.x > zone.x && slot.x < zone.x + zone.w && slot.y > zone.y && slot.y < zone.y + zone.h), `${q.id} ${slot.id} outside every zone`);
    assert.match(q.prompt, /Solid arrows show the primary traffic path/);
    assert.match(key(q.id).explanation, /Primary traffic path:/);
  }
  for (const q of bundle.questions.filter((q) => q.interaction.type === 'firewall_rules')) {
    assert.doesNotMatch(q.prompt, /exactly one|do not add|no separate response rule/i);
    assert.ok(q.interaction.max_user_rules > key(q.id).answer.solution_rules.length);
  }
});
test('source packs and combined bank retain identical stems, keys and PBQ tasks', () => {
  for (const name of ['security_plus_sy0_701_study_pack.zip','test_prep_2_security_plus_sy0_701.zip']) {
    const pack = importQuestionFile(name, fs.readFileSync(new URL('../'+name, import.meta.url)));
    for (const q of pack.questions) {
      assert.equal(item(q.id).prompt, q.question);
      assert.deepEqual([key(q.id).answer].flat(), q.correctIds);
      assert.equal(key(q.id).explanation, q.explanation);
    }
    for (const p of pack.pbqs) assert.deepEqual(item(p.id).interaction.tasks, p.tasks.map((task) => ({...task, selectCount: task.response_type === 'multi_select' ? p.answer_key.find((k) => k.task_id === task.id).correct_response.length : undefined})));
  }
});
test('vulnerability and response drills match actual objective and exam domain metadata', () => {
  assert.equal(item('SPX-VULN_TRIA-001').objective_id,'4.3');
  assert.equal(item('SPX-IN_ORDER-031').objective_id,'4.7');
  for (const q of bundle.questions.filter((q) => q.origin !== 'legacy-pbq-v1')) assert.equal(q.domain_id, Number(q.objective_id[0]));
  for (const exam of bundle.exams.slice(0,10)) {
    const domains = Object.fromEntries([1,2,3,4,5].map((d) => [d, exam.items.filter((slot) => item(slot.id).domain_id === d).length]));
    assert.deepEqual(domains, exam.blueprint.domain_target_counts);
  }
});
