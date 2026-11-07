import { isIP } from 'node:net';
import { matchesCommand } from './command-match.mjs';
import { gradePbq } from './scoring.mjs';

const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
const unique = (values) => new Set(values).size === values.length;
const idsOf = (values) => values.map((entry) => typeof entry === 'string' ? entry : entry.id);
const normalized = (value) => String(value ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[–—]/g, '-').match(/[a-z0-9]+/g)?.join(' ') || '';

export function parseIpv4(value) {
  if (typeof value !== 'string' || isIP(value) !== 4) fail('Enter a valid IPv4 address.');
  return value.split('.').reduce((sum, byte) => ((sum << 8) | Number(byte)) >>> 0, 0);
}
export function parseCidr(value) {
  if (typeof value !== 'string' || value.length > 32) fail('Enter a valid CIDR.');
  const [ip, bits, extra] = value.split('/');
  if (extra !== undefined || !/^\d{1,2}$/.test(bits || '') || Number(bits) > 32) fail('Enter an IPv4 CIDR with a prefix from 0 to 32.');
  const prefix = Number(bits);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { network: parseIpv4(ip) & mask, mask, prefix, text: `${ip}/${prefix}` };
}
function contains(cidr, ip) { const range = parseCidr(cidr); return (parseIpv4(ip) & range.mask) === range.network; }
function sameCidr(a, b) { const x = parseCidr(a); const y = parseCidr(b); return x.network === y.network && x.prefix === y.prefix; }

export function validateFirewallRules(input, max = 5) {
  if (!Array.isArray(input) || input.length > max) fail(`Enter at most ${max} firewall rules.`);
  const priorities = new Set();
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Invalid firewall rule.');
    const priority = Number(raw.priority);
    const destination_port = Number(raw.destination_port);
    const action = String(raw.action || '').toLowerCase();
    const protocol = String(raw.protocol || '').toLowerCase();
    if (!Number.isInteger(priority) || priority < 1 || priority > 1000 || priorities.has(priority)) fail('Firewall priorities must be unique integers from 1 to 1000.');
    if (!['allow', 'deny'].includes(action) || !['tcp', 'udp'].includes(protocol)) fail('Choose allow or deny and TCP or UDP.');
    if (!Number.isInteger(destination_port) || destination_port < 1 || destination_port > 65535) fail('Enter a destination port from 1 to 65535.');
    parseCidr(raw.source_cidr); parseCidr(raw.destination_cidr);
    priorities.add(priority);
    return { priority, action, protocol, source_cidr: raw.source_cidr, destination_cidr: raw.destination_cidr, destination_port };
  });
}

export function firewallDecision(rules, flow) {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (rule.protocol !== flow.proto || rule.destination_port !== flow.port) continue;
    if (contains(rule.source_cidr, flow.src) && contains(rule.destination_cidr, flow.dst)) return rule.action === 'allow';
  }
  return false;
}

export function sanitizeResponse(item, response) {
  if (response === null || response === undefined) return null;
  const ui = item.interaction;
  switch (ui.type) {
    case 'single_select': {
      if (typeof response !== 'string' || !idsOf(ui.options).includes(response)) fail('Choose one listed answer.');
      return response;
    }
    case 'multi_select': {
      const candidates = ui.candidate_ids || idsOf(ui.options || []);
      if (!Array.isArray(response) || response.length > candidates.length || !unique(response) || response.some((id) => typeof id !== 'string' || !candidates.includes(id))) fail('Choose valid distinct evidence rows.');
      return [...response];
    }
    case 'text_entry': {
      if (typeof response !== 'string' || response.length > (ui.max_length || 200)) fail('Text response is too long.');
      return response;
    }
    case 'numeric': {
      if (typeof response !== 'string' && typeof response !== 'number') fail('Enter a finite number.');
      const text = String(response).trim();
      if (text.length > 40 || !/^\$?\s*-?(?:\d+(?:,\d{3})*|\d+)(?:\.\d+)?$/.test(text)) fail('Enter a finite number.');
      const value = Number(text.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(value) || (ui.min !== undefined && value < ui.min) || (ui.max !== undefined && value > ui.max)) fail('Number is outside the allowed range.');
      return value;
    }
    case 'matching':
    case 'topology': {
      if (!response || typeof response !== 'object' || Array.isArray(response)) fail('Enter valid placements.');
      const left = idsOf(ui.type === 'matching' ? ui.left : ui.slots);
      const right = idsOf(ui.type === 'matching' ? ui.right : ui.elements);
      const entries = Object.entries(response);
      if (entries.length > left.length || entries.some(([a, b]) => !left.includes(a) || !right.includes(b))) fail('Unknown match or placement.');
      if ((ui.one_to_one || ui.unique_assignment) && !unique(entries.map(([, b]) => b))) fail('Each target can be used only once.');
      return Object.fromEntries(entries);
    }
    case 'ordering':
    case 'timeline': {
      const cards = idsOf(ui.type === 'ordering' ? ui.cards : ui.events);
      if (!Array.isArray(response) || response.length !== cards.length || !unique(response) || response.some((id) => !cards.includes(id))) fail('Order every card exactly once.');
      return [...response];
    }
    case 'simulated_cli': {
      if (!response || typeof response !== 'object' || Array.isArray(response)) fail('Enter a command and interpretation.');
      const command = String(response.command || '').trim();
      const interpretation = String(response.interpretation || '');
      if (command.length > 200 || interpretation.length > 500 || (interpretation && !ui.interpretation_options.includes(interpretation))) fail('Invalid simulator response.');
      return { command, interpretation };
    }
    case 'firewall_rules': return validateFirewallRules(response, ui.max_user_rules || 5);
    case 'legacy_pbq': {
      if (!response || typeof response !== 'object' || Array.isArray(response)) fail('Enter valid PBQ task responses.');
      const tasks = new Map(ui.tasks.map((task) => [task.id, task]));
      if (Object.keys(response).length > tasks.size) fail('Too many PBQ task responses.');
      const result = {};
      for (const [id, value] of Object.entries(response)) {
        const task = tasks.get(id);
        if (!task) fail('Unknown PBQ task.');
        const choices = idsOf(task.options || []);
        if (task.response_type === 'single_select' && !(typeof value === 'string' && choices.includes(value))) fail('Invalid PBQ selection.');
        if (task.response_type === 'multi_select' && !(Array.isArray(value) && unique(value) && value.every((part) => choices.includes(part)))) fail('Invalid PBQ selections.');
        if (task.response_type === 'ordering' && !(Array.isArray(value) && value.length === choices.length && unique(value) && value.every((part) => choices.includes(part)))) fail('Invalid PBQ order.');
        if (task.response_type === 'number' && !(typeof value === 'string' && value.length <= 40 && (value.trim() === '' || Number.isFinite(Number(value))))) fail('Invalid PBQ number.');
        result[id] = value;
      }
      return result;
    }
    default: fail('Unsupported interaction type.');
  }
}

function exactSet(actual, expected) { return Array.isArray(actual) && actual.length === expected.length && unique(actual) && actual.every((id) => expected.includes(id)); }
function mappingScore(response, expected, points) {
  const entries = Object.entries(expected);
  return Math.round(points * entries.filter(([left, right]) => response?.[left] === right).length / entries.length * 100) / 100;
}
function orderScore(response, expected, points) {
  if (!exactSet(response, expected)) return 0;
  return Math.round(points * response.filter((id, index) => id === expected[index]).length / expected.length * 100) / 100;
}
function exactRule(rule, wanted) {
  return rule.action === 'allow' && rule.protocol === wanted.proto && rule.destination_port === wanted.port && sameCidr(rule.source_cidr, wanted.src) && sameCidr(rule.destination_cidr, wanted.dst);
}
export function gradePractical(item, key, rawResponse) {
  const response = rawResponse === null || rawResponse === undefined ? null : sanitizeResponse(item, rawResponse);
  const type = item.interaction.type;
  const points = key.points;
  const wanted = key.answer;
  let earned = 0;
  let detail = null;
  switch (type) {
    case 'single_select': earned = response === wanted ? points : 0; break;
    case 'multi_select': earned = exactSet(response, wanted) ? points : 0; break;
    case 'text_entry': earned = Array.isArray(wanted) && wanted.some((answer) => normalized(response) === normalized(answer)) ? points : 0; break;
    case 'numeric': earned = typeof response === 'number' && Math.abs(response - Number(wanted)) <= Number(item.interaction.tolerance_abs || 0) ? points : 0; break;
    case 'matching':
    case 'topology': earned = mappingScore(response, wanted, points); break;
    case 'ordering':
    case 'timeline': earned = Math.max(...(key.valid_orders || [wanted]).map((order) => orderScore(response, order, points))); break;
    case 'simulated_cli': {
      const goodCommand = Boolean(matchesCommand(response?.command, wanted.accepted_commands, item.interaction.shell));
      const goodRead = response?.interpretation === wanted.interpretation;
      earned = points * (Number(goodCommand) + Number(goodRead)) / 2;
      detail = { commandAccepted: goodCommand, interpretationCorrect: goodRead };
      break;
    }
    case 'firewall_rules': {
      if (!response) break;
      const allowed = wanted.allow_flows || [];
      const denied = wanted.deny_flows || [];
      const total = allowed.length + denied.length;
      const passing = allowed.filter((flow) => firewallDecision(response, flow)).length + denied.filter((flow) => !firewallDecision(response, flow)).length;
      earned = total ? Math.round(points * passing / total * 100) / 100 : 0;
      const exact = response.length === wanted.solution_rules.length && wanted.solution_rules.every((rule) => response.some((candidate) => exactRule(candidate, rule)));
      if (!exact) earned = Math.min(earned, Math.round(points * 0.8 * 100) / 100);
      detail = { allowedPassed: allowed.filter((flow) => firewallDecision(response, flow)).length, allowedTotal: allowed.length, deniedPassed: denied.filter((flow) => !firewallDecision(response, flow)).length, deniedTotal: denied.length, minimalScope: exact };
      break;
    }
    case 'legacy_pbq': {
      const original = { tasks: item.interaction.tasks, answer_key: key.answer_key, max_points: points };
      const result = gradePbq(original, response || {});
      earned = result.points;
      detail = { tasks: result.tasks };
      break;
    }
    default: fail('Unsupported interaction type.');
  }
  return { earned, possible: points, correct: earned === points, explanation: key.explanation || '', detail, correctAnswer: type === 'legacy_pbq' ? null : wanted, rationales: key.rationales || null };
}

export function simulateCli(item, key, command) {
  if (item.interaction.type !== 'simulated_cli' || typeof command !== 'string' || command.length > 200) fail('Invalid simulator command.');
  // Finite allowlist only. The command is compared as text and is never executed.
  const accepted = matchesCommand(command, key.answer.accepted_commands, item.interaction.shell);
  return accepted ? { accepted: true, output: item.interaction.output_preview_after_submission } : { accepted: false, output: '' };
}

export function publicPracticalItem(item) {
  const copy = { ...item, interaction: { ...item.interaction } };
  if (copy.interaction.type === 'simulated_cli') delete copy.interaction.output_preview_after_submission;
  return copy;
}
