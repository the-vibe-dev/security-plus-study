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

const STIMULUS_LABELS = { prior_steps_complete: 'Already completed, in order', runbook: 'Runbook', safety_assumption: 'Safety assumption', assume_clocks_synchronized: 'Clocks synchronized', evidence_type: 'Evidence type', supported_syntax: 'Supported syntax', host: 'Lab scope', scenario: 'Scenario', capture_label: 'Capture', diagram_title: 'Diagram', instructions: 'Instructions', backup_age_minutes: 'Latest backup age (minutes)', rpo_minutes: 'RPO (minutes)', exam_style: 'Format', acronym: 'Acronym', example_domain: 'Example domain', source_segment: 'Source segment', context: 'Context', evidence: 'Evidence', application: 'Application', architecture: 'Architecture', server: 'Server', service: 'Service', boundary: 'Boundary', topology: 'Topology' };
// Keys drawn elsewhere (tables, diagrams) or withheld during the attempt (formula hints are available in learning mode).
const STIMULUS_HIDDEN = new Set(['rows', 'events', 'logs', 'packets', 'connections', 'scenario_md', 'exhibits', 'formula_reference', 'zones', 'anchors', 'legend']);
function stimulusLabel(key) { return STIMULUS_LABELS[key] || key.replaceAll('_', ' '); }
function StimulusValue({ value }) {
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return <ol className="evidence-list">{value.map((part, index) => <li key={index}>{part}</li>)}</ol>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string' && value.includes('\n')) return <pre className="evidence-pre">{value}</pre>;
  return <span>{asText(value)}</span>;
}

export function EvidencePanel({ stimulus, prompt = '' }) {
  if (!stimulus || !Object.keys(stimulus).length) return null;
  const rows = stimulus.rows || stimulus.events || stimulus.logs || stimulus.packets;
  const context = Object.entries(stimulus).filter(([key, value]) => !STIMULUS_HIDDEN.has(key) && value !== '' && value !== null && value !== undefined && !(key === 'scenario' && value === prompt) && !(Array.isArray(value) && value.length === 0));
  if (!context.length && !stimulus.scenario_md && !(Array.isArray(rows) && rows.length) && !Array.isArray(stimulus.exhibits)) return null;
  return <section className="practical-evidence" aria-label="Scenario evidence">
    {stimulus.scenario_md && <div className="practical-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{stimulus.scenario_md}</ReactMarkdown></div>}
    {context.length > 0 && <div className="evidence-context">{context.map(([key, value]) => <div key={key} className={Array.isArray(value) || (typeof value === 'string' && value.length > 90) ? 'evidence-wide' : ''}><strong>{stimulusLabel(key)}</strong><StimulusValue value={value} /></div>)}</div>}
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

// Network diagram: trust zones, fixed anchors (Internet, user networks), device slots and typed links.
const NODE_W = 14, NODE_H = 12;
function deviceKind(label = '') {
  const text = label.toLowerCase();
  if (/firewall|security group/.test(text)) return 'firewall';
  if (/waf|proxy|gateway/.test(text)) return 'shield';
  if (/database|storage|vault|records|data subnet|mail storage|mailbox/.test(text)) return 'database';
  if (/jump|bastion/.test(text)) return 'terminal';
  if (/ids|nids|sensor|tap|monitor/.test(text)) return 'eye';
  if (/vpn|ztna|policy enforcement/.test(text)) return 'lock';
  return 'server';
}
function DeviceGlyph({ kind, x, y }) {
  const s = 'currentColor';
  switch (kind) {
    case 'firewall': return <g transform={`translate(${x} ${y})`} fill="none" stroke={s} strokeWidth="0.45"><rect x="-2.4" y="-2" width="4.8" height="4" rx="0.3" /><line x1="-2.4" y1="-0.7" x2="2.4" y2="-0.7" /><line x1="-2.4" y1="0.7" x2="2.4" y2="0.7" /><line x1="-0.8" y1="-2" x2="-0.8" y2="-0.7" /><line x1="0.8" y1="-0.7" x2="0.8" y2="0.7" /><line x1="-0.8" y1="0.7" x2="-0.8" y2="2" /></g>;
    case 'shield': return <g transform={`translate(${x} ${y})`} fill="none" stroke={s} strokeWidth="0.45"><path d="M0 -2.4 L2.3 -1.5 C2.3 0.6 1.3 1.8 0 2.5 C-1.3 1.8 -2.3 0.6 -2.3 -1.5 Z" /><path d="M-0.9 0 L-0.2 0.7 L1 -0.8" /></g>;
    case 'database': return <g transform={`translate(${x} ${y})`} fill="none" stroke={s} strokeWidth="0.45"><ellipse cx="0" cy="-1.7" rx="2.3" ry="0.8" /><path d="M-2.3 -1.7 V1.7 C-2.3 2.2 -1.2 2.5 0 2.5 C1.2 2.5 2.3 2.2 2.3 1.7 V-1.7" /><path d="M-2.3 0 C-2.3 0.5 -1.2 0.8 0 0.8 C1.2 0.8 2.3 0.5 2.3 0" /></g>;
    case 'terminal': return <g transform={`translate(${x} ${y})`} fill="none" stroke={s} strokeWidth="0.45"><rect x="-2.5" y="-1.9" width="5" height="3.8" rx="0.4" /><path d="M-1.6 -0.8 L-0.6 0 L-1.6 0.8" /><line x1="0" y1="0.9" x2="1.6" y2="0.9" /></g>;
    case 'eye': return <g transform={`translate(${x} ${y})`} fill="none" stroke={s} strokeWidth="0.45"><path d="M-2.6 0 C-1.5 -1.7 1.5 -1.7 2.6 0 C1.5 1.7 -1.5 1.7 -2.6 0 Z" /><circle cx="0" cy="0" r="0.8" /></g>;
    case 'lock': return <g transform={`translate(${x} ${y})`} fill="none" stroke={s} strokeWidth="0.45"><rect x="-2" y="-0.6" width="4" height="3" rx="0.4" /><path d="M-1.2 -0.6 V-1.5 C-1.2 -2.9 1.2 -2.9 1.2 -1.5 V-0.6" /></g>;
    default: return <g transform={`translate(${x} ${y})`} fill="none" stroke={s} strokeWidth="0.45"><rect x="-2.4" y="-2.2" width="4.8" height="1.9" rx="0.3" /><rect x="-2.4" y="0.3" width="4.8" height="1.9" rx="0.3" /><circle cx="1.5" cy="-1.25" r="0.3" fill={s} /><circle cx="1.5" cy="1.25" r="0.3" fill={s} /></g>;
  }
}
function wrapLabel(text, max = 13) {
  const words = String(text).split(/\s+/); const lines = [];
  for (const word of words) { if (lines.length && (lines.at(-1) + ' ' + word).length <= max) lines[lines.length - 1] += ' ' + word; else lines.push(word); }
  return lines.slice(0, 3);
}
function edgePoint(node, towards) {
  // Intersection of the segment node→towards with the node's rectangle (or circle for anchors).
  const dx = towards.x - node.x, dy = towards.y - node.y;
  const hw = node.w / 2, hh = node.h / 2;
  if (!dx && !dy) return { x: node.x, y: node.y };
  const scale = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}
export function TopologyDiagram({ item, current, disabled, onAssign }) {
  const ui = item.interaction;
  const stimulus = item.stimulus || {};
  const elementById = new Map(ui.elements.map((element) => [element.id, element]));
  const nodes = new Map();
  for (const slot of ui.slots) nodes.set(slot.id, { ...slot, w: NODE_W, h: NODE_H, slot: true });
  for (const anchor of stimulus.anchors || []) nodes.set(anchor.id, { ...anchor, w: anchor.kind === 'segment' ? 14 : 11, h: anchor.kind === 'segment' ? 9 : 8, slot: false });
  const connections = (stimulus.connections || []).filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  const kinds = new Set(connections.map((edge) => edge.kind || 'traffic'));
  const letter = (slot) => slot.label.replace('Placement ', '');
  return <>
    <div className="topology-canvas-wrap"><svg viewBox={`0 0 ${ui.canvas?.width || 100} ${ui.canvas?.height || 75}`} role="img" aria-label={`Network diagram: ${stimulus.diagram_title || 'place devices in network zones'}. ${ui.slots.length} placement slots.`}>
      <defs>
        <marker id={`arrow-${item.id}`} markerWidth="4" markerHeight="4" refX="3.2" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L4 2 L0 4 Z" fill="currentColor" /></marker>
        <marker id={`arrow-admin-${item.id}`} markerWidth="4" markerHeight="4" refX="3.2" refY="2" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L4 2 L0 4 Z" fill="currentColor" /></marker>
      </defs>
      {(stimulus.zones || []).map((zone) => <g key={zone.id} className="topology-zone"><rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="1.2" /><text x={zone.x + 1.4} y={zone.y + 3.2}>{zone.label}</text></g>)}
      {connections.map((edge, index) => {
        const a = nodes.get(edge.from), b = nodes.get(edge.to);
        const via = Array.isArray(edge.via) ? edge.via : [];
        const start = edgePoint(a, via[0] ? { x: via[0][0], y: via[0][1] } : b);
        const end = edgePoint(b, via.length ? { x: via.at(-1)[0], y: via.at(-1)[1] } : a);
        const points = [[start.x, start.y], ...via, [end.x, end.y]];
        const kind = edge.kind || 'traffic';
        const mid = points[Math.floor((points.length - 1) / 2)], next = points[Math.floor((points.length - 1) / 2) + 1];
        const span = Math.hypot(next[0] - mid[0], next[1] - mid[1]);
        const label = edge.label && (edge.label_at || span >= 8) ? edge.label_at ? { x: edge.label_at[0], y: edge.label_at[1] } : { x: (mid[0] + next[0]) / 2 + (mid[1] === next[1] ? 0 : 1.2), y: (mid[1] + next[1]) / 2 - (mid[1] === next[1] ? 1.2 : 0) } : null;
        return <g key={index} className={`topology-link ${kind}`}>
          <polyline points={points.map((p) => p.join(',')).join(' ')} markerEnd={kind === 'monitor' ? undefined : `url(#arrow-${kind === 'admin' ? 'admin-' : ''}${item.id})`} />
          {kind === 'monitor' && <circle cx={end.x} cy={end.y} r="0.9" className="topology-tap" />}
          {label && <text x={label.x} y={label.y} textAnchor="middle" className="topology-link-label">{edge.label}</text>}
        </g>;
      })}
      {(stimulus.anchors || []).map((anchor) => { const node = nodes.get(anchor.id); return <g key={anchor.id} className={`topology-anchor ${anchor.kind || 'segment'}`}>
        {anchor.kind === 'internet' ? <path d={`M${node.x - 4.5} ${node.y + 2.2} C${node.x - 7} ${node.y + 2.2} ${node.x - 7} ${node.y - 1.6} ${node.x - 4.2} ${node.y - 1.4} C${node.x - 4} ${node.y - 4.4} ${node.x + 0.5} ${node.y - 4.6} ${node.x + 1.4} ${node.y - 2.2} C${node.x + 4.5} ${node.y - 3} ${node.x + 6.5} ${node.y - 0.2} ${node.x + 4.6} ${node.y + 2.2} Z`} />
          : anchor.kind === 'users' ? <g><circle cx={node.x - 2} cy={node.y - 1.8} r="1.1" /><path d={`M${node.x - 4.2} ${node.y + 2.4} C${node.x - 4.2} ${node.y - 0.6} ${node.x + 0.2} ${node.y - 0.6} ${node.x + 0.2} ${node.y + 2.4} Z`} /><circle cx={node.x + 2.2} cy={node.y - 1.8} r="1.1" /><path d={`M${node.x} ${node.y + 2.4} C${node.x} ${node.y - 0.6} ${node.x + 4.4} ${node.y - 0.6} ${node.x + 4.4} ${node.y + 2.4} Z`} /></g>
          : <rect x={node.x - node.w / 2} y={node.y - node.h / 2} width={node.w} height={node.h} rx="1" />}
        {wrapLabel(anchor.label, 13).map((line, index, all) => <text key={index} x={node.x} y={node.y + (anchor.kind === 'segment' ? -0.4 : 5.2) + index * 2.6 - (anchor.kind === 'segment' ? (all.length - 1) * 1.3 : 0)} textAnchor="middle" className="topology-anchor-label">{line}</text>)}
      </g>; })}
      {ui.slots.map((slot) => { const node = nodes.get(slot.id); const assigned = elementById.get(current[slot.id]); const lines = assigned ? wrapLabel(assigned.label) : ['Place device']; const kind = assigned ? deviceKind(assigned.label) : null; return <g key={slot.id} className={`topology-slot ${assigned ? 'placed' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!disabled) onAssign(slot.id, event.dataTransfer.getData('text/plain')); }}>
        <title>{`${slot.label}: ${slot.hint || ''}`}</title>
        <rect x={node.x - NODE_W / 2} y={node.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx="1.2" className="topology-node" />
        <rect x={node.x - NODE_W / 2} y={node.y - NODE_H / 2} width="4" height="3.4" rx="0.8" className="topology-badge" /><text x={node.x - NODE_W / 2 + 2} y={node.y - NODE_H / 2 + 2.5} textAnchor="middle" className="topology-badge-text">{letter(slot)}</text>
        {kind ? <DeviceGlyph kind={kind} x={node.x} y={node.y - 2.9} /> : <text x={node.x} y={node.y - 1.4} textAnchor="middle" className="topology-node-empty">?</text>}
        {lines.map((line, index) => <text key={index} x={node.x} y={node.y + 1.4 + index * 1.9} textAnchor="middle" className={assigned ? 'topology-node-device' : 'topology-node-placeholder'}>{line}</text>)}
      </g>; })}
    </svg></div>
    {kinds.size > 0 && <ul className="topology-legend" aria-label="Diagram legend">{kinds.has('traffic') && <li><span className="legend-line traffic" /> Primary traffic path</li>}{kinds.has('admin') && <li><span className="legend-line admin" /> Administrative access</li>}{kinds.has('monitor') && <li><span className="legend-line monitor" /> Passive monitoring tap</li>}</ul>}
  </>;
}

function TopologyQuestion({ item, response, onChange, disabled }) {
  const ui = item.interaction;
  const current = response || {};
  const assign = (slot, element) => onChange(assignUnique(current, slot, element, ui.unique_assignment));
  return <div className="topology-board"><TopologyDiagram item={item} current={current} disabled={disabled} onAssign={assign} /><div className="topology-selects">{ui.slots.map((slot) => <label key={slot.id}><span><strong>{slot.label}</strong><small>{slot.hint}</small></span><select aria-label={`Device for ${slot.label}`} disabled={disabled} value={current[slot.id] || ''} onChange={(event) => assign(slot.id, event.target.value)}><option value="">Choose device</option>{ui.elements.map((element) => <option key={element.id} value={element.id}>{element.label}</option>)}</select></label>)}</div><div className="matching-palette" aria-label="Draggable network devices">{ui.elements.map((element) => <span draggable={!disabled} onDragStart={(event) => event.dataTransfer.setData('text/plain', element.id)} key={element.id}>{element.label}</span>)}</div><p className="practical-hint">{item.stimulus?.instructions || (ui.role_assignment ? 'Independent role cards: no packet-flow or management path is depicted.' : 'Follow the drawn paths and trust boundaries.')} Drag a device onto a slot, or use the select menus.</p></div>;
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
  return <div className="cli-simulator"><div className="cli-banner">Practice simulator · no real commands executed</div><p>{item.interaction.display}</p>{item.interaction.command_choices && <label>Command choices<select aria-label="Command choices" disabled={disabled} value="" onChange={(event) => onChange({ ...value, command: event.target.value })}><option value="">Choose a command</option>{item.interaction.command_choices.map((command) => <option key={command} value={command}>{command}</option>)}</select></label>}<div className="cli-terminal"><span className="cli-prompt">{item.interaction.shell === 'powershell' ? 'PS Lab>' : item.interaction.shell === 'cmd' ? 'CMD Lab>' : 'lab$'}</span><input aria-label="Simulated command" spellCheck="false" autoComplete="off" disabled={disabled} value={value.command || ''} placeholder={item.interaction.command_placeholder || 'Enter a lab command'} onChange={(event) => onChange({ ...value, command: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); run(); } }} /><button type="button" onClick={run} disabled={disabled || running || !value.command?.trim()}>{running ? 'Loading…' : 'Run in simulator'}</button></div>{message && <p className="cli-message" role="status">{message}</p>}{output && <pre className="cli-output">{output}</pre>}{(output || value.interpretation) && <fieldset className="cli-interpretation"><legend>What does the output support?</legend>{item.interaction.interpretation_options.map((option, index) => <label key={option}><input type="radio" checked={value.interpretation === option} disabled={disabled} onChange={() => onChange({ ...value, interpretation: option })} /><span>{String.fromCharCode(65 + index)}. {option}</span></label>)}</fieldset>}</div>;
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
  return <article className="practical-question"><div className="question-taxonomy"><span>Domain {item.domain_id}</span><span>Objective {item.objective_id || '—'}</span><span>{type.replaceAll('_', ' ')}</span></div><h2>{item.prompt}</h2><FlagContent key={item.id} item={item} /><EvidencePanel stimulus={item.stimulus} prompt={item.prompt} />
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
