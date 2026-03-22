import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

function buildClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Copy .env.example to .env and add your Supabase project URL and service role key.'
    );
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

let _instance = null;

/**
 * Service-role client for the Telegram bot (server-side only).
 * Lazy-initialized so the process can start (e.g. to show Telegram token errors) before .env is complete.
 */
export default new Proxy(
  {},
  {
    get(_target, prop) {
      if (!_instance) {
        _instance = buildClient();
      }
      const value = _instance[prop];
      return typeof value === 'function' ? value.bind(_instance) : value;
    },
  }
);
