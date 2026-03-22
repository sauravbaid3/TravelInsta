import { searchBookings } from '../db/bookings.js';
import { formatMoney } from '../formatter.js';
import { clearSession } from '../sessions.js';

function typeEmoji(bt) {
  const b = (bt || '').toLowerCase();
  if (b === 'flight') return '✈️';
  if (b === 'hotel') return '🏨';
  if (b === 'tour_package') return '🌍';
  if (b === 'train') return '🚂';
  if (b === 'bus') return '🚌';
  return '📋';
}

function esc(s) {
  return String(s || '').replace(/[`*_]/g, ' ');
}

function dateLine(b) {
  if (b.travel_date) return b.travel_date;
  if (b.check_in) return b.check_in;
  if (b.tour_start_date) return b.tour_start_date;
  return '—';
}

export async function handleSearchCommand(bot, msg) {
  const chatId = msg.chat.id;
  clearSession(chatId);
  const arg = (msg.text || '').replace(/^\/search(@\w+)?\s*/i, '').trim();
  if (!arg) {
    await bot.sendMessage(
      chatId,
      'Please provide a search term.\nExample: `/search ABC123` or `/search Sharma`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  let results;
  try {
    results = await searchBookings(arg);
  } catch {
    await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  if (!results.length) {
    await bot.sendMessage(chatId, `No bookings found for '${esc(arg)}'`, {
      parse_mode: 'Markdown',
    });
    return;
  }
  const chunks = [];
  for (const b of results) {
    const rev = Number(b.invoice_amount) || 0;
    const cost = Number(b.supplier_cost) || 0;
    const profit = Math.round((rev - cost) * 100) / 100;
    const profitEmoji = profit > 0 ? '💰' : profit < 0 ? '🔴' : '⚠️';
    const em = typeEmoji(b.booking_type);
    const desc = b.invoice_description ? esc(b.invoice_description) : '—';
    chunks.push(
      [
        `${em} *#${b.id}* | ${esc(b.party_name)}`,
        desc,
        `Date: ${esc(dateLine(b))}`,
        `Revenue: ${formatMoney(rev)} | Cost: ${formatMoney(cost)}`,
        `Profit: ${formatMoney(profit)} ${profitEmoji}`,
      ].join('\n')
    );
  }
  await bot.sendMessage(chatId, chunks.join('\n\n').slice(0, 3900), {
    parse_mode: 'Markdown',
  });
}
