const KEY = 'security-study-sessions-v3';
const OLD_KEY = 'security-study-session-v2';

export function readSessionStore(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (saved?.version === 3 && Array.isArray(saved.sessions)) return saved.sessions.filter((item) => item?.id && Array.isArray(item.questionIds)).slice(-80);
  } catch { /* A damaged browser draft should not block the site. */ }
  try {
    const old = JSON.parse(storage.getItem(OLD_KEY));
    if (old?.id && Array.isArray(old.questionIds)) return [old];
  } catch { /* No old draft. */ }
  return [];
}

export function saveSessionStore(storage, sessions) {
  storage.setItem(KEY, JSON.stringify({ version: 3, sessions: sessions.slice(-80) }));
  storage.removeItem(OLD_KEY);
}
