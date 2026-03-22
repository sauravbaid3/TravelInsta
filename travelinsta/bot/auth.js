import dotenv from 'dotenv';

dotenv.config();

const raw = process.env.ALLOWED_CHAT_IDS || '';
const allowed = raw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function isAllowed(chatId) {
  const id = String(chatId);
  return allowed.includes(id);
}
