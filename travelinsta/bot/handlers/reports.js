import { getBookingsInDateRange } from '../db/bookings.js';
import { formatMoney } from '../formatter.js';
import { clearSession } from '../sessions.js';

function istPeriod(period) {
  if (period === 'all') {
    return { startIso: null, endIso: null, label: 'All time' };
  }
  const tz = 'Asia/Kolkata';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const now = new Date();
  const todayStr = fmt.format(now);
  if (period === 'today') {
    const start = new Date(`${todayStr}T00:00:00+05:30`);
    const end = new Date(`${todayStr}T23:59:59.999+05:30`);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      label: 'Today',
    };
  }
  if (period === 'month') {
    const [y, m] = todayStr.split('-');
    const start = new Date(`${y}-${m}-01T00:00:00+05:30`);
    return {
      startIso: start.toISOString(),
      endIso: now.toISOString(),
      label: 'This month',
    };
  }
  return { startIso: null, endIso: null, label: 'All time' };
}

function periodFromCallback(data) {
  if (data === 'profit_today') return 'today';
  if (data === 'profit_month') return 'month';
  if (data === 'profit_all') return 'all';
  return null;
}

function esc(s) {
  return String(s || '').replace(/[`*_]/g, ' ');
}

export async function handleProfitCommand(bot, chatId) {
  clearSession(chatId);
  await bot.sendMessage(chatId, '📊 *Profit report — pick a period*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Today', callback_data: 'profit_today' },
          { text: 'This month', callback_data: 'profit_month' },
        ],
        [{ text: 'All time', callback_data: 'profit_all' }],
      ],
    },
  });
}

export async function handleProfitCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data || '';
  const period = periodFromCallback(data);
  if (!period) return;
  const { startIso, endIso, label } = istPeriod(period);
  let list;
  try {
    list = await getBookingsInDateRange(startIso, endIso);
  } catch {
    await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  let totalRevenue = 0;
  let totalCost = 0;
  const byType = { flight: 0, hotel: 0, tour_package: 0, train: 0, bus: 0, other: 0 };
  const withProfit = [];
  for (const b of list) {
    const rev = Number(b.invoice_amount) || 0;
    const cost = Number(b.supplier_cost) || 0;
    totalRevenue += rev;
    totalCost += cost;
    const bt = (b.booking_type || 'other').toLowerCase();
    if (byType[bt] === undefined) byType.other += 1;
    else byType[bt] += 1;
    const profit = Math.round((rev - cost) * 100) / 100;
    withProfit.push({ b, profit, desc: b.invoice_description || `#TI-${b.id}` });
  }
  totalRevenue = Math.round(totalRevenue * 100) / 100;
  totalCost = Math.round(totalCost * 100) / 100;
  const netProfit = Math.round((totalRevenue - totalCost) * 100) / 100;
  withProfit.sort((a, b) => b.profit - a.profit);
  const top = withProfit.slice(0, 3);
  const lines = [
    `📊 *Profit — ${label}*`,
    '─────────────────────────',
    `Bookings:    ${list.length}`,
    `Revenue:     ${formatMoney(totalRevenue)}`,
    `Cost:        ${formatMoney(totalCost)}`,
    `Net profit:  ${formatMoney(netProfit)} 💰`,
    '─────────────────────────',
    '*By type:*',
    `✈️ ${byType.flight}  🏨 ${byType.hotel}  🌍 ${byType.tour_package}  🚂 ${byType.train}  🚌 ${byType.bus}`,
    '─────────────────────────',
    '*Top bookings:*',
  ];
  top.forEach((t, i) => {
    const emoji = t.profit > 0 ? '💰' : t.profit < 0 ? '🔴' : '⚠️';
    lines.push(`${i + 1}. ${esc(t.desc)} — ${formatMoney(t.profit)} ${emoji}`);
  });
  if (!top.length) lines.push('_No bookings in this period._');
  await bot.sendMessage(chatId, lines.join('\n').slice(0, 3900), { parse_mode: 'Markdown' });
}
