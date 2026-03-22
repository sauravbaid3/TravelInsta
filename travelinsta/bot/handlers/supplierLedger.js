import {
  searchSuppliersByName,
  getSupplierById,
  getSupplierBalance,
  getSupplierStatement,
} from '../db/suppliers.js';
import { createSupplierPayment } from '../db/payments.js';
import {
  getSession,
  setSession,
  updateSession,
  clearSession,
} from '../sessions.js';
import { formatMoney } from '../formatter.js';

function esc(s) {
  return String(s || '').replace(/[`*_]/g, ' ');
}

export async function handleSupplierCommand(bot, msg) {
  const chatId = msg.chat.id;
  clearSession(chatId);
  const arg = (msg.text || '').replace(/^\/supplier(@\w+)?\s*/i, '').trim();
  if (!arg) {
    await bot.sendMessage(
      chatId,
      'Please provide a supplier name.\nExample: `/supplier Ramesh`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  let list;
  try {
    list = await searchSuppliersByName(arg);
  } catch {
    await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  if (!list.length) {
    await bot.sendMessage(chatId, `No supplier found for "${esc(arg)}".`, {
      parse_mode: 'Markdown',
    });
    return;
  }
  if (list.length === 1) {
    await sendSupplierCard(bot, chatId, list[0].id);
    return;
  }
  const rows = list.slice(0, 8).map((s, i) => [
    { text: `${i + 1}. ${s.name.slice(0, 28)}`, callback_data: `supsel:${s.id}` },
  ]);
  await bot.sendMessage(chatId, '*Pick a supplier:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendSupplierCard(bot, chatId, supplierId) {
  let sup;
  let bal;
  let stmt;
  try {
    sup = await getSupplierById(supplierId);
    bal = await getSupplierBalance(supplierId);
    stmt = await getSupplierStatement(supplierId);
  } catch {
    await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  const owed = bal.balance > 0.009;
  const balEmoji = owed ? '🔴' : '✅';
  const lines = [
    `*${esc(sup.name)}*`,
    sup.phone ? `Phone: ${esc(sup.phone)}` : '',
    sup.upi_id ? `UPI: ${esc(sup.upi_id)}` : '',
    '─────────────────────────',
    `Total floated:  ${formatMoney(bal.totalCost)}`,
    `Total paid back: ${formatMoney(bal.totalPaid)}`,
    `Balance owed:   ${formatMoney(bal.balance)} ${balEmoji}`,
    '─────────────────────────',
    '*Recent bookings:*',
  ].filter(Boolean);
  for (const b of stmt.recentBookings || []) {
    const d = new Date(b.created_at).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
    const desc = b.invoice_description ? esc(b.invoice_description) : '—';
    lines.push(`${d} | ${desc} | ${formatMoney(b.supplier_cost)}`);
  }
  const text = lines.join('\n').slice(0, 3500);
  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💸 Record Payment to Supplier', callback_data: `ps_go:${supplierId}` }],
      ],
    },
  });
}

export async function handleSupplierCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data || '';
  if (data.startsWith('supsel:')) {
    const id = data.slice(7);
    await sendSupplierCard(bot, chatId, id);
    return;
  }
  if (data.startsWith('ps_go:')) {
    const supplierId = parseInt(data.slice(6), 10);
    setSession(chatId, {
      flow: 'pay_supplier',
      step: 'ask_amount',
      supplier_id: supplierId,
      supplier_name: null,
      pay_amount: null,
      payment_mode: null,
    });
    await bot.sendMessage(
      chatId,
      '💸 *Payment to supplier*\n\nEnter the *amount* (numbers only).',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  if (data.startsWith('ps_mode:')) {
    const mode = data.slice(8);
    updateSession(chatId, { payment_mode: mode, step: 'ask_reference' });
    await bot.sendMessage(
      chatId,
      'Enter payment *reference* or type _skip_.',
      { parse_mode: 'Markdown' }
    );
    return;
  }
}

export async function handlePaySupplierCommand(bot, msg) {
  const chatId = msg.chat.id;
  setSession(chatId, {
    flow: 'pay_supplier',
    step: 'ask_sup_name',
    supplier_id: null,
    pay_amount: null,
    payment_mode: null,
  });
  await bot.sendMessage(
    chatId,
    '💸 *Who are you paying?*\nType the supplier *name* (partial match ok).',
    { parse_mode: 'Markdown' }
  );
}

export async function handleSupplierPayMessage(bot, msg, session) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const step = session.step;

  if (step === 'ask_sup_name') {
    let list;
    try {
      list = await searchSuppliersByName(text);
    } catch {
      await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    if (!list.length) {
      await bot.sendMessage(chatId, 'No match. Try another name or add supplier via a booking.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    if (list.length === 1) {
      updateSession(chatId, {
        supplier_id: list[0].id,
        supplier_name: list[0].name,
        step: 'ask_amount',
      });
      await bot.sendMessage(chatId, 'Enter the *amount* paid to this supplier.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    const rows = list.slice(0, 8).map((s) => [
      { text: s.name.slice(0, 40), callback_data: `ps_pick:${s.id}` },
    ]);
    await bot.sendMessage(chatId, '*Pick supplier:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }

  if (step === 'ask_amount') {
    const amt = parseFloat(text.replace(/₹|,/g, ''));
    if (Number.isNaN(amt) || amt <= 0) {
      await bot.sendMessage(chatId, 'Please send a valid amount. Example: _8400_', {
        parse_mode: 'Markdown',
      });
      return;
    }
    updateSession(chatId, {
      pay_amount: Math.round(amt * 100) / 100,
      step: 'ask_mode',
    });
    await bot.sendMessage(chatId, 'Select *payment mode*:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'UPI', callback_data: 'ps_mode:UPI' },
            { text: 'NEFT', callback_data: 'ps_mode:NEFT' },
          ],
          [
            { text: 'Cash', callback_data: 'ps_mode:Cash' },
            { text: 'Cheque', callback_data: 'ps_mode:Cheque' },
          ],
        ],
      },
    });
    return;
  }

  if (step === 'ask_reference') {
    const ref = text.toLowerCase() === 'skip' ? null : text;
    const s = getSession(chatId);
    if (!s || !s.supplier_id || !s.pay_amount || !s.payment_mode) {
      clearSession(chatId);
      await bot.sendMessage(chatId, 'Session lost. Run /paysupplier again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    try {
      await createSupplierPayment({
        supplierId: s.supplier_id,
        bookingId: null,
        amount: s.pay_amount,
        paymentMode: s.payment_mode,
        reference: ref,
        notes: null,
      });
    } catch {
      await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    let bal;
    try {
      bal = await getSupplierBalance(s.supplier_id);
    } catch {
      bal = null;
    }
    clearSession(chatId);
    const tail = bal
      ? `\n\n*Updated balance owed:* ${formatMoney(bal.balance)} ${bal.balance > 0.009 ? '🔴' : '✅'}`
      : '';
    await bot.sendMessage(
      chatId,
      `✅ Recorded ${formatMoney(s.pay_amount)} to supplier via *${esc(s.payment_mode)}*.${tail}`,
      { parse_mode: 'Markdown' }
    );
  }
}

export async function handleSupplierPayPickCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data || '';
  if (!data.startsWith('ps_pick:')) return;
  const id = parseInt(data.slice(8), 10);
  let sup;
  try {
    sup = await getSupplierById(id);
  } catch {
    await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  updateSession(chatId, {
    supplier_id: sup.id,
    supplier_name: sup.name,
    step: 'ask_amount',
  });
  await bot.sendMessage(chatId, `Paying *${esc(sup.name)}*\nEnter the *amount*.`, {
    parse_mode: 'Markdown',
  });
}
