/**
 * Loads .env from project root and tests each integration.
 * Does not print secrets.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL } from '../bot/gemini.js';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const envPath = join(root, '.env');

const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass, detail: String(detail).slice(0, 200) });
}

console.log('Using .env:', envPath, existsSync(envPath) ? '(file exists)' : '(missing file)');

const required = [
  'TELEGRAM_BOT_TOKEN',
  'GEMINI_API_KEY',
  'ALLOWED_CHAT_IDS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
];

for (const key of required) {
  const v = process.env[key];
  const set = Boolean(v && String(v).trim());
  record(`Variable ${key}`, set, set ? 'set' : 'empty or missing');
}

const allowedRaw = process.env.ALLOWED_CHAT_IDS || '';
const allowedIds = allowedRaw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
record(
  'ALLOWED_CHAT_IDS list',
  allowedIds.length > 0,
  allowedIds.length ? `${allowedIds.length} chat id(s)` : 'need at least one id'
);

// Telegram Bot API
try {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('token not set');
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || 'getMe failed');
  record(
    'Telegram getMe',
    true,
    json.result?.username ? `bot @${json.result.username}` : 'ok'
  );
} catch (e) {
  record('Telegram getMe', false, e.message);
}

// Gemini
try {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('key not set');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent('Reply with exactly the word OK and nothing else.');
  const text = (result.response.text() || '').trim();
  record(`Gemini ${GEMINI_MODEL}`, /OK/i.test(text), text.slice(0, 50));
} catch (e) {
  record(`Gemini ${GEMINI_MODEL}`, false, e.message);
}

// Supabase
try {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) throw new Error('url or service key not set');
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.from('suppliers').select('id').limit(1);
  if (error) throw new Error(error.message);
  record('Supabase (read suppliers)', true, 'OK');
} catch (e) {
  const hint =
    /relation|does not exist|schema cache/i.test(e.message)
      ? ' — run migrations (SQL editor or npm run db:push)'
      : '';
  record('Supabase (read suppliers)', false, e.message + hint);
}

console.log('\n=== Results ===\n');
for (const { name, pass, detail } of results) {
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${failed.length ? failed.length + ' check(s) failed.' : 'All checks passed.'}\n`
);
process.exit(failed.length ? 1 : 0);
