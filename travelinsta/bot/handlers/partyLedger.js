import {
  getDistinctPartiesMatching,
  getOpenBookingsForParty,
} from '../db/bookings.js';
import { getPartyBalance, getPartyStatement } from '../db/parties.js';
import { createPartyPayment } from '../db/payments.js';
import { getSession, setSession, updateSession, clearSession } from '../sessions.js';
import { formatMoney } from '../formatter.js';

function esc(s) {
  return String(s || '').replace(/[`*_]/g, ' ');
}

async function sendPartyCard(bot, chatId, partyName) {
  let bal;
  let stmt;
  try {
    bal = await getPartyBalance(partyName);
    stmt = await getPartyStatement(partyName);
  } catch {
    await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  const due = bal.balance > 0.009;
  const balEmoji = due ? '🔴' : '✅';
  const lines = [
    `*${esc(partyName)}*`,
    '─────────────────────────',
    `Total invoiced:  ${formatMoney(bal.totalInvoiced)}`,
    `Total received: ${formatMoney(bal.totalReceived)}`,
    `Balance due:     ${formatMoney(bal.balance)} ${balEmoji}`,
    '─────────────────────────',
    '*Recent invoices:*',
  ];
  for (const b of stmt.recentBookings || []) {
    const d = new Date(b.created_at).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
    const desc = b.invoice_description ? esc(b.invoice_description) : '—';
    lines.push(`${d} | ${desc} | ${formatMoney(b.invoice_amount)}`);
  }
  const payload = lines.join('\n').slice(0, 3500);
  updateSession(chatId, { last_party_card: partyName });
  await bot.sendMessage(chatId, payload, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Record Payment Received', callback_data: 'pp_go' }]],
    },
  });
}

export async function handlePartyCommand(bot, msg) {
  const chatId = msg.chat.id;
  clearSession(chatId);
  const arg = (msg.text || '').replace(/^\/party(@\w+)?\s*/i, '').trim();
  if (!arg) {
    await bot.sendMessage(
      chatId,
      'Please provide a party name.\nExample: `/party Sharma Enterprises`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  let parties;
  try {
    parties = await getDistinctPartiesMatching(arg);
  } catch {
    await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  if (!parties.length) {
    await bot.sendMessage(chatId, `No party found for "${esc(arg)}".`, {
      parse_mode: 'Markdown',
    });
    return;
  }
  if (parties.length === 1) {
    await sendPartyCard(bot, chatId, parties[0]);
    return;
  }
  const choices = parties.slice(0, 8);
  updateSession(chatId, { party_idx_choices: choices, party_pick_mode: 'ledger' });
  const rows = choices.map((p, i) => [
    { text: `${i + 1}. ${p.slice(0, 28)}`, callback_data: `ptyidx:${i}` },
  ]);
  await bot.sendMessage(chatId, '*Pick a party:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: rows },
  });
}

export async function handlePartyCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data || '';
  if (data.startsWith('ptyidx:')) {
    const idx = parseInt(data.slice(7), 10);
    const s = getSession(chatId);
    const list = s?.party_idx_choices || [];
    const name = list[idx];
    if (!name) return;
    if (s?.party_pick_mode === 'receive') {
      updateSession(chatId, {
        party_name: name,
        step: 'pick_invoice',
        party_pick_mode: null,
        party_idx_choices: null,
      });
      let open;
      try {
        open = await getOpenBookingsForParty(name);
      } catch {
        await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
          parse_mode: 'Markdown',
        });
        return;
      }
      if (!open.length) {
        clearSession(chatId);
        await bot.sendMessage(chatId, 'No open invoices. ✅', { parse_mode: 'Markdown' });
        return;
      }
      const lines = open
        .slice(0, 10)
        .map((b) => `• \`#TI-${b.id}\` — ${formatMoney(b.amount_due)} due`)
        .join('\n');
      const rows = open.slice(0, 10).map((b) => [
        { text: `Invoice #TI-${b.id}`, callback_data: `pp_inv:${b.id}` },
      ]);
      await bot.sendMessage(chatId, `*Pick an invoice:*\n${lines}`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }
    await sendPartyCard(bot, chatId, name);
    return;
  }
  if (data === 'pp_go') {
    const s = getSession(chatId);
    const name = s?.last_party_card;
    if (!name) return;
    setSession(chatId, {
      flow: 'receive_payment',
      step: 'pick_invoice',
      party_name: name,
      booking_id: null,
      pay_amount: null,
      payment_mode: null,
    });
    let open;
    try {
      open = await getOpenBookingsForParty(name);
    } catch {
      await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    if (!open.length) {
      clearSession(chatId);
      await bot.sendMessage(
        chatId,
        'No open invoices for this party (or already fully paid). ✅',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    const lines = open
      .slice(0, 10)
      .map((b) => `• \`#TI-${b.id}\` — ${formatMoney(b.amount_due)} due`)
      .join('\n');
    const rows = open.slice(0, 10).map((b) => [
      { text: `Invoice #TI-${b.id}`, callback_data: `pp_inv:${b.id}` },
    ]);
    await bot.sendMessage(chatId, `*Which invoice?*\n${lines}`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }
  if (data.startsWith('pp_mode:')) {
    const mode = data.slice(8);
    updateSession(chatId, { payment_mode: mode, step: 'ask_pp_ref' });
    await bot.sendMessage(
      chatId,
      'Enter payment *reference* or type _skip_.',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  if (data.startsWith('pp_inv:')) {
    const bookingId = parseInt(data.slice(7), 10);
    updateSession(chatId, { booking_id: bookingId, step: 'ask_pp_amount' });
    await bot.sendMessage(
      chatId,
      'Enter the *amount received* from the party.',
      { parse_mode: 'Markdown' }
    );
    return;
  }
}

export async function handleReceivePaymentCommand(bot, msg) {
  const chatId = msg.chat.id;
  setSession(chatId, {
    flow: 'receive_payment',
    step: 'ask_party_name',
    party_name: null,
    booking_id: null,
    pay_amount: null,
    payment_mode: null,
  });
  await bot.sendMessage(
    chatId,
    '💰 *Which party paid?*\nType the *party name* (as on invoice).',
    { parse_mode: 'Markdown' }
  );
}

export async function handlePartyPayMessage(bot, msg, session) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const step = session.step;

  if (step === 'ask_party_name') {
    let parties;
    try {
      parties = await getDistinctPartiesMatching(text);
    } catch {
      await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    if (!parties.length) {
      await bot.sendMessage(chatId, 'No matching party. Check spelling or create a booking first.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    if (parties.length === 1) {
      const name = parties[0];
      updateSession(chatId, { party_name: name, step: 'pick_invoice' });
      let open;
      try {
        open = await getOpenBookingsForParty(name);
      } catch {
        await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
          parse_mode: 'Markdown',
        });
        return;
      }
      if (!open.length) {
        clearSession(chatId);
        await bot.sendMessage(chatId, 'No open invoices for this party. ✅', {
          parse_mode: 'Markdown',
        });
        return;
      }
      const lines = open
        .slice(0, 10)
        .map((b) => `• \`#TI-${b.id}\` — ${formatMoney(b.amount_due)} due`)
        .join('\n');
      const rows = open.slice(0, 10).map((b) => [
        { text: `Invoice #TI-${b.id}`, callback_data: `pp_inv:${b.id}` },
      ]);
      await bot.sendMessage(chatId, `*Pick an invoice:*\n${lines}`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }
    const choices = parties.slice(0, 8);
    updateSession(chatId, { party_idx_choices: choices, party_pick_mode: 'receive' });
    const rows = choices.map((p, i) => [
      { text: `${i + 1}. ${p.slice(0, 28)}`, callback_data: `ptyidx:${i}` },
    ]);
    await bot.sendMessage(chatId, '*Pick party:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: rows },
    });
    return;
  }

  if (step === 'ask_pp_amount') {
    const amt = parseFloat(text.replace(/₹|,/g, ''));
    if (Number.isNaN(amt) || amt <= 0) {
      await bot.sendMessage(chatId, 'Please send a valid amount.', { parse_mode: 'Markdown' });
      return;
    }
    updateSession(chatId, {
      pay_amount: Math.round(amt * 100) / 100,
      step: 'ask_pp_mode',
    });
    await bot.sendMessage(chatId, 'Select *mode*:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'UPI', callback_data: 'pp_mode:UPI' },
            { text: 'NEFT', callback_data: 'pp_mode:NEFT' },
          ],
          [
            { text: 'Cash', callback_data: 'pp_mode:Cash' },
            { text: 'Cheque', callback_data: 'pp_mode:Cheque' },
          ],
        ],
      },
    });
    return;
  }

  if (step === 'ask_pp_ref') {
    const ref = text.toLowerCase() === 'skip' ? null : text;
    const s = getSession(chatId);
    if (!s || !s.booking_id || !s.party_name || !s.pay_amount || !s.payment_mode) {
      clearSession(chatId);
      await bot.sendMessage(chatId, 'Session lost. Run /receivepayment again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    try {
      await createPartyPayment({
        bookingId: s.booking_id,
        partyName: s.party_name,
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
      bal = await getPartyBalance(s.party_name);
    } catch {
      bal = null;
    }
    clearSession(chatId);
    const tail = bal
      ? `\n\n*Balance due now:* ${formatMoney(bal.balance)} ${bal.balance > 0.009 ? '🔴' : '✅'}`
      : '';
    await bot.sendMessage(
      chatId,
      `✅ Recorded ${formatMoney(s.pay_amount)} from *${esc(s.party_name)}*.${tail}`,
      { parse_mode: 'Markdown' }
    );
  }
}
