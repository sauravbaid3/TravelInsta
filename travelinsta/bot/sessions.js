const sessions = new Map();
const TTL_MS = 30 * 60 * 1000;

function defaultSession() {
  return {
    flow: null,
    step: null,
    extracted: {},
    original_text: '',
    party_name: null,
    supplier_name: null,
    supplier_id: null,
    supplier_cost: null,
    invoice_amount: null,
    invoice_description: null,
    started_at: Date.now(),
  };
}

export function getSession(chatId) {
  const s = sessions.get(String(chatId));
  return s || null;
}

export function setSession(chatId, data) {
  const id = String(chatId);
  const base = defaultSession();
  sessions.set(id, { ...base, ...data, started_at: Date.now() });
}

export function updateSession(chatId, partial) {
  const id = String(chatId);
  const cur = sessions.get(id) || defaultSession();
  sessions.set(id, { ...cur, ...partial });
}

export function clearSession(chatId) {
  sessions.delete(String(chatId));
}

export function isExpired(chatId) {
  const s = sessions.get(String(chatId));
  if (!s || !s.started_at) return false;
  return Date.now() - s.started_at > TTL_MS;
}
