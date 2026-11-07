export const DOMAINS = [
  'General Security Concepts',
  'Threats, Vulnerabilities, and Mitigations',
  'Security Architecture',
  'Security Operations',
  'Security Program Management and Oversight',
];

export function domainName(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(?:domain\s*)?([1-5])(?:[.\s:–-]|$)/i);
  if (match) return DOMAINS[Number(match[1]) - 1];
  return DOMAINS.find((domain) => domain.toLowerCase() === text.toLowerCase()) || text || 'Uncategorized';
}
