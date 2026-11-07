export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...options.headers, ...(!['GET', 'HEAD'].includes(method) ? { 'x-study-request': '1' } : {}) };
  const response = await fetch(path, { cache: 'no-store', ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

export function jsonPost(path, body) {
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
