import { FlagContent } from './ContentReview.jsx';
import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function asText(value) { return typeof value === 'string' ? value : value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
function optionId(option) { return typeof option === 'string' ? option : option.id; }
function optionText(option) { return typeof option === 'string' ? option : option.text || option.label || option.id; }
// Resolve stored identifiers against this item's displayed choices, which may be shuffled.
export function expectedAnswerText(item, answer) {
  const ui = item.interaction;
  const choices = (records, value) => {
    const record = records?.find((entry) => optionId(entry) === value);
    return record ? optionText(record) : asText(value);
  };
  switch (ui.type) {
    case 'single_select': return choices(ui.options, answer);
    case 'multi_select': {
      const records = ui.options || [...(item.stimulus?.rows || []), ...(item.stimulus?.events || [])].map((row) => ({ id: row.id, text: `${row.id}: ${evidenceText(row)}` }));
      return Array.isArray(answer) ? answer.map((value) => choices(records, value)) : answer;
    }
    case 'ordering':
    case 'timeline': return Array.isArray(answer) ? answer.map((value) => choices(ui.cards || ui.events, value)) : answer;
    case 'matching':
    case 'topology': return answer && typeof answer === 'object' ? Object.entries(answer).map(([left, right]) => `${choices(ui.left || ui.slots, left)} → ${choices(ui.right || ui.elements, right)}`) : answer;
    default: return answer;
  }
}
function evidenceText(row) { return Object.entries(row).filter(([key]) => key !== 'id').map(([key, value]) => `${key.replaceAll('_', ' ')}: ${asText(value)}`).join(' · '); }

export function assignUnique(current, left, right, unique = true) {
  const next = { ...(current || {}) };
  if (unique && right) for (const key of Object.keys(next)) if (key !== left && next[key] === right) delete next[key];
  if (right) next[left] = right; else delete next[left];
  return next;
}
export function moveCard(cards, from, to) {
  const next = [...cards];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length || from === to) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function EvidencePanel({ stimulus }) {
  if (!stimulus || !Object.keys(stimulus).length) return null;
  const rows = stimulus.rows || stimulus.events || stimulus.logs || stimulus.packets;
  const skip = new Set(['rows', 'events', 'logs', 'packets', 'connections', 'scenario_md', 'exhibits']);
  const context = Object.entries(stimulus).filter(([key, value]) => !skip.has(key) && value !== '' && value !== null && value !== undefined);
  return <section className="practical-evidence" aria-label="Scenario evidence">
    {stimulus.scenario_md && <div className="practical-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{stimulus.scenario_md}</ReactMarkdown></div>}
    {context.length > 0 && <div className="evidence-context">{context.map(([key, value]) => <div key={key}><strong>{key.replaceAll('_', ' ')}</strong><span>{asText(value)}</span></div>)}</div>}
    {Array.isArray(rows) && rows.length > 0 && <div className="evidence-scroll"><table className="evidence-table"><caption>Synthetic evidence records</caption><thead><tr><th scope="col">ID</th>{Object.keys(rows[0]).filter((key) => key !== 'id').map((key) => <th key={key} scope="col">{key.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}><th scope="row">{row.id || index + 1}</th>{Object.keys(rows[0]).filter((key) => key !== 'id').map((key) => <td key={key}>{asText(row[key])}</td>)}</tr>)}</tbody></table></div>}
    {Array.isArray(stimulus.exhibits) && stimulus.exhibits.map((exhibit) => <details className="evidence-exhibit" key={exhibit.id} open><summary>{exhibit.title}</summary><div className="practical-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{exhibit.content_md}</ReactMarkdown></div></details>)}
  </section>;
}

function SelectQuestion({ item, response, onChange, disabled }) {
  const ui = item.interaction;
  const candidates = ui.options || ui.candidate_ids?.map((id) => {
    const row = [...(item.stimulus.rows || []), ...(item.stimulus.events || [])].find((entry) => entry.id === id);
    return { id, text: row ? evidenceText(row) : id };
  }) || [];
  const multi = ui.type === 'multi_select';
  const selected = multi ? Array.isArray(response) ? response : [] : response;
  return <div className="practical-choice-list" role={multi ? 'group' : 'radiogroup'} aria-label="Answer choices">
    {candidates.map((option, index) => { const id = optionId(option); const checked = multi ? selected.includes(id) : selected === id; return <label className={`practical-choice ${checked ? 'chosen' : ''}`} key={id}>
      <input type={multi ? 'checkbox' : 'radio'} name={`choice-${item.id}`} checked={checked} disabled={disabled} onChange={() => multi ? onChange(checked ? selected.filter((part) => part !== id) : [...selected, id]) : onChange(id)} />
      <span className="choice-letter">{String.fromCharCode(65 + index)}</span><span>{optionText(option)}</span>
    </label>; })}
    {multi && <small>Choose {ui.min_selections && ui.max_selections ? ui.min_selections === ui.max_selections ? ui.min_selections : `${ui.min_selections}–${ui.max_selections}` : 'all that apply'} distinct answers.</small>}
  </div>;
}

function MatchingQuestion({ item, response, onChange, disabled }) {
  const ui = item.interaction;
  const current = response || {};
  return <div className="matching-board"><div className="matching-head"><span>Prompt</span><span>Match</span></div>{ui.left.map((left) => <div className="matching-row" key={left.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled) onChange(assignUnique(current, left.id, event.dataTransfer.getData('text/plain'), ui.one_to_one)); }}><strong>{left.label || left.text}</strong><select aria-label={`Match for ${left.label || left.text}`} disabled={disabled} value={current[left.id] || ''} onChange={(event) => onChange(assignUnique(current, left.id, event.target.value, ui.one_to_one))}><option value="">Choose a match</option>{ui.right.map((right) => <option key={right.id} value={right.id}>{right.label || right.text}</option>)}</select></div>)}<div className="matching-palette" aria-label="Draggable match choices">{ui.right.map((right) => <span draggable={!disabled} onDragStart={(event) => event.dataTransfer.setData('text/plain', right.id)} key={right.id}>{right.label || right.text}</span>)}</div><p className="practical-hint">Drag a choice onto a prompt, or use its select menu with a keyboard or touch screen.</p></div>;
}

function OrderedQuestion({ item, response, onChange, disabled }) {
  const ui = item.interaction;
  const records = ui.type === 'timeline' ? ui.events : ui.cards;
  const byId = new Map(records.map((record) => [record.id, record]));
  const order = Array.isArray(response) && response.length === records.length ? response : records.map((record) => record.id);
  const [dragged, setDragged] = useState(null);
  useEffect(() => setDragged(null), [item.id]);
  return <div className="ordering-list" aria-label="Reorder the steps">{order.map((id, index) => { const record = byId.get(id); return <div className="ordering-card" key={id} draggable={!disabled} onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled && dragged !== null) onChange(moveCard(order, dragged, index)); setDragged(null); }}><span className="order-number">{index + 1}</span><div><strong>{record.text || record.label || id}</strong>{record.local_time && <small>{record.local_time}</small>}</div><div className="order-controls"><button type="button" aria-label={`Move ${id} up`} disabled={disabled || index === 0} onClick={() => onChange(moveCard(order, index, index - 1))}>↑</button><button type="button" aria-label={`Move ${id} down`} disabled={disabled || index === order.length - 1} onClick={() => onChange(moveCard(order, index, index + 1))}>↓</button></div></div>; })}<button type="button" disabled={disabled} onClick={() => onChange([...order])}>Use this order</button><p className="practical-hint">Confirm the visible order or move cards with the arrow buttons. Timeline times may use different UTC offsets.</p></div>;
}

function TopologyQuestion({ item, response, onChange, disabled }) {
  const ui = item.interaction;
  const current = response || {};
  const slotById = new Map(ui.slots.map((slot) => [slot.id, slot]));
  const elementById = new Map(ui.elements.map((element) => [element.id, element]));
  return <div className="topology-board"><div className="topology-canvas-wrap"><svg viewBox="0 0 100 75" role="img" aria-label={`Network topology: ${item.stimulus.diagram_title || 'place devices in network zones'}`}><defs><marker id={`arrow-${item.id}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 L5 2.5 L0 5" fill="none" stroke="currentColor" strokeWidth="1" /></marker></defs>{(item.stimulus.connections || []).map((edge, index) => { const a = slotById.get(edge.from); const b = slotById.get(edge.to); return a && b ? <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="topology-line" markerEnd={`url(#arrow-${item.id})`} /> : null; })}{ui.slots.map((slot) => <g key={slot.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled) onChange(assignUnique(current, slot.id, event.dataTransfer.getData('text/plain'), ui.unique_assignment)); }}><circle cx={slot.x} cy={slot.y} r="8" className={current[slot.id] ? 'topology-node placed' : 'topology-node'} /><text x={slot.x} y={slot.y - 1} textAnchor="middle" className="topology-node-label">{slot.label.replace('Placement ', '')}</text><text x={slot.x} y={slot.y + 4} textAnchor="middle" className="topology-node-device">{(elementById.get(current[slot.id])?.label || 'Place device').slice(0, 16)}</text></g>)}</svg></div><div className="topology-selects">{ui.slots.map((slot) => <label key={slot.id}><span><strong>{slot.label}</strong><small>{slot.hint}</small></span><select aria-label={`Device for ${slot.label}`} disabled={disabled} value={current[slot.id] || ''} onChange={(event) => onChange(assignUnique(current, slot.id, event.target.value, ui.unique_assignment))}><option value="">Choose device</option>{ui.elements.map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}</select></label>)}</div><div className="matching-palette" aria-label="Draggable network devices">{ui.elements.map((element) => <span draggable={!disabled} onDragStart={(event) => event.dataTransfer.setData('text/plain', element.id)} key={element.id}>{element.label}</span>)}</div><p className="practical-hint">{ui.role_assignment ? 'Independent role cards: no packet-flow or management path is depicted.' : 'Follow the scenario-specific connections and trust boundaries.'} Drag a device onto a node, or use the accessible select menus.</p></div>;
}

function CliQuestion({ item, response, onChange, disabled, onSimulate }) {
  const value = response || { command: '', interpretation: '' };
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  useEffect(() => { setOutput(''); setMessage(''); }, [item.id]);
  async function run() {
    setRunning(true);
    try { const result = await onSimulate(value.command); setOutput(result.accepted ? result.output : ''); setMessage(result.accepted ? 'Canned lab output loaded.' : 'Command not recognized by this lab fixture. Check the requested tool, flags, target, and scope.'); }
    catch (err) { setMessage(err.message); }
    finally { setRunning(false); }
  }
  return <div className="cli-simulator"><div className="cli-banner">Practice simulator · no real commands executed</div><p>{item.interaction.display}</p>{item.interaction.command_choices && <label>Supported command forms<select aria-label="Supported command forms" disabled={disabled} value="" onChange={(event) => onChange({ ...value, command: event.target.value })}><option value="">Choose a supported form</option>{item.interaction.command_choices.map((command) => <option key={command} value={command}>{command}</option>)}</select></label>}<div className="cli-terminal"><span className="cli-prompt">{item.interaction.shell === 'powershell' ? 'PS Lab>' : item.interaction.shell === 'cmd' ? 'CMD Lab>' : 'lab$'}</span><input aria-label="Simulated command" spellCheck="false" autoComplete="off" disabled={disabled} value={value.command || ''} placeholder={item.interaction.command_placeholder || 'Enter a lab command'} onChange={(event) => onChange({ ...value, command: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); run(); } }} /><button type="button" onClick={run} disabled={disabled || running || !value.command?.trim()}>{running ? 'Loading…' : 'Run in simulator'}</button></div>{message && <p className="cli-message" role="status">{message}</p>}{output && <pre className="cli-output">{output}</pre>}{(output || value.interpretation) && <fieldset className="cli-interpretation"><legend>What does the output support?</legend>{item.interaction.interpretation_options.map((option, index) => <label key={option}><input type="radio" checked={value.interpretation === option} disabled={disabled} onChange={() => onChange({ ...value, interpretation: option })} /><span>{String.fromCharCode(65 + index)}. {option}</span></label>)}</fieldset>}</div>;
}

function FirewallQuestion({ item, response, onChange, disabled, onTestFlow }) {
  const rules = Array.isArray(response) ? response : [];
  const [flow, setFlow] = useState({ src: '', dst: '', proto: 'tcp', port: 443 });
  const [flowResult, setFlowResult] = useState('');
  const max = item.interaction.max_user_rules || 5;
  function patch(index, key, value) { onChange(rules.map((rule, i) => i === index ? { ...rule, [key]: value } : rule)); }
  function add() { if (rules.length < max) onChange([...rules, { priority: (rules.length + 1) * 10, action: 'deny', protocol: 'tcp', source_cidr: '0.0.0.0/32', destination_cidr: '0.0.0.0/32', destination_port: 443 }]); }
  function shift(index, direction) { const next = moveCard(rules, index, index + direction).map((rule, i) => ({ ...rule, priority: (i + 1) * 10 })); onChange(next); }
  async function testFlow() { try { const result = await onTestFlow(rules, { ...flow, port: Number(flow.port) }); setFlowResult(`Simulated decision: ${result.decision.toUpperCase()}. First matching rule wins; default is deny.`); } catch (err) { setFlowResult(err.message); } }
  return <div className="firewall-builder"><div className="firewall-heading"><div><strong>Firewall rule editor</strong><small>Ordered, first-match evaluation · stateful return traffic assumed</small></div><span>Default: DENY</span></div><div className="firewall-scroll"><table className="firewall-table"><thead><tr><th>Order</th><th>Action</th><th>Protocol</th><th>Source CIDR</th><th>Destination CIDR</th><th>Port</th><th>Move / remove</th></tr></thead><tbody>{rules.map((rule, index) => <tr key={index}><td>{index + 1}</td><td><select aria-label={`Rule ${index + 1} action`} disabled={disabled} value={rule.action} onChange={(event) => patch(index, 'action', event.target.value)}><option value="allow">Allow</option><option value="deny">Deny</option></select></td><td><select aria-label={`Rule ${index + 1} protocol`} disabled={disabled} value={rule.protocol} onChange={(event) => patch(index, 'protocol', event.target.value)}><option value="tcp">TCP</option><option value="udp">UDP</option></select></td><td><input aria-label={`Rule ${index + 1} source CIDR`} disabled={disabled} value={rule.source_cidr} onChange={(event) => patch(index, 'source_cidr', event.target.value)} /></td><td><input aria-label={`Rule ${index + 1} destination CIDR`} disabled={disabled} value={rule.destination_cidr} onChange={(event) => patch(index, 'destination_cidr', event.target.value)} /></td><td><input aria-label={`Rule ${index + 1} destination port`} inputMode="numeric" disabled={disabled} value={rule.destination_port} onChange={(event) => patch(index, 'destination_port', event.target.value)} /></td><td className="rule-actions"><button type="button" aria-label={`Move rule ${index + 1} up`} disabled={disabled || index === 0} onClick={() => shift(index, -1)}>↑</button><button type="button" aria-label={`Move rule ${index + 1} down`} disabled={disabled || index === rules.length - 1} onClick={() => shift(index, 1)}>↓</button><button type="button" aria-label={`Remove rule ${index + 1}`} disabled={disabled} onClick={() => onChange(rules.filter((_, i) => i !== index).map((part, i) => ({ ...part, priority: (i + 1) * 10 })))}>×</button></td></tr>)}</tbody></table></div><button className="practical-inline-button" type="button" disabled={disabled || rules.length >= max} onClick={add}>+ Add rule</button><div className="traffic-test"><strong>Test traffic against your rules</strong><div><label>Source IP<input aria-label="Test source IP" value={flow.src} onChange={(event) => setFlow({ ...flow, src: event.target.value })} placeholder="192.0.2.10" /></label><label>Destination IP<input aria-label="Test destination IP" value={flow.dst} onChange={(event) => setFlow({ ...flow, dst: event.target.value })} placeholder="198.51.100.10" /></label><label>Protocol<select aria-label="Test protocol" value={flow.proto} onChange={(event) => setFlow({ ...flow, proto: event.target.value })}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label><label>Port<input aria-label="Test port" inputMode="numeric" value={flow.port} onChange={(event) => setFlow({ ...flow, port: event.target.value })} /></label><button type="button" disabled={disabled} onClick={testFlow}>Test traffic</button></div>{flowResult && <p role="status">{flowResult}</p>}</div></div>;
}

function LegacyPbqQuestion({ item, response, onChange, disabled }) {
  const current = response || {};
  function update(id, value) { onChange({ ...current, [id]: value }); }
  return <div className="legacy-tasks">{item.interaction.tasks.map((task) => <fieldset className="legacy-task" key={task.id}><legend><strong>{task.id}</strong> {task.prompt}</legend>{task.response_type === 'single_select' && task.options.map((option) => <label key={option.id}><input type="radio" name={`${item.id}-${task.id}`} checked={current[task.id] === option.id} disabled={disabled} onChange={() => update(task.id, option.id)} />{option.text}</label>)}{task.response_type === 'multi_select' && task.options.map((option) => { const selected = Array.isArray(current[task.id]) ? current[task.id] : []; return <label key={option.id}><input type="checkbox" checked={selected.includes(option.id)} disabled={disabled} onChange={() => update(task.id, selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id])} />{option.text}</label>; })}{task.response_type === 'ordering' && <OrderedQuestion item={{ id: `${item.id}-${task.id}`, interaction: { type: 'ordering', cards: task.options.map((option) => ({ id: option.id, text: option.text })) } }} response={current[task.id]} onChange={(value) => update(task.id, value)} disabled={disabled} />}{task.response_type === 'number' && <input aria-label={task.prompt} inputMode="decimal" disabled={disabled} value={current[task.id] || ''} onChange={(event) => update(task.id, event.target.value)} />}</fieldset>)}</div>;
}

export function QuestionRenderer({ item, response, onChange, feedback, disabled = false, onSimulate = async () => ({ accepted: false }), onTestFlow = async () => ({ decision: 'deny' }) }) {
  const type = item.interaction.type;
  return <article className="practical-question"><div className="question-taxonomy"><span>Domain {item.domain_id}</span><span>Objective {item.objective_id || '—'}</span><span>{type.replaceAll('_', ' ')}</span></div><h2>{item.prompt}</h2><FlagContent key={item.id} item={item} /><EvidencePanel stimulus={item.stimulus} />
    {['single_select', 'multi_select'].includes(type) && <SelectQuestion item={item} response={response} onChange={onChange} disabled={disabled} />}
    {type === 'text_entry' && <label className="practical-entry"><span>Type the full expansion</span><input value={response || ''} disabled={disabled} maxLength={item.interaction.max_length || 200} placeholder={item.interaction.placeholder || 'Your answer'} onChange={(event) => onChange(event.target.value)} autoComplete="off" /></label>}
    {type === 'numeric' && <label className="practical-entry"><span>Calculate your answer {item.interaction.unit && `(${item.interaction.unit})`}</span><input value={response ?? ''} disabled={disabled} inputMode="decimal" placeholder="Enter a number" onChange={(event) => onChange(event.target.value)} /></label>}
    {type === 'matching' && <MatchingQuestion item={item} response={response} onChange={onChange} disabled={disabled} />}
    {['ordering', 'timeline'].includes(type) && <OrderedQuestion key={item.id} item={item} response={response} onChange={onChange} disabled={disabled} />}
    {type === 'topology' && <TopologyQuestion item={item} response={response} onChange={onChange} disabled={disabled} />}
    {type === 'simulated_cli' && <CliQuestion key={item.id} item={item} response={response} onChange={onChange} disabled={disabled} onSimulate={onSimulate} />}
    {type === 'firewall_rules' && <FirewallQuestion item={item} response={response} onChange={onChange} disabled={disabled} onTestFlow={onTestFlow} />}
    {type === 'legacy_pbq' && <LegacyPbqQuestion item={item} response={response} onChange={onChange} disabled={disabled} />}
    {feedback && <section className="question-feedback" aria-live="polite"><h3>{feedback.earned} / {feedback.possible} practice points</h3><FlagContent item={item} feedback={feedback} target="explanation" />{feedback.explanation && <p>{feedback.explanation}</p>}{feedback.detail?.tasks && <ul>{feedback.detail.tasks.map((task) => <li key={task.taskId}>{task.taskId}: {task.points}/{task.possible} points · {task.explanation}</li>)}</ul>}{feedback.correctAnswer !== null && feedback.correctAnswer !== undefined && <details><summary>Show expected answer</summary><pre>{asText(expectedAnswerText(item, feedback.correctAnswer))}</pre></details>}</section>}
  </article>;
}
