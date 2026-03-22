import 'dotenv/config';
import fetch from 'node-fetch';
import TelegramBot from 'node-telegram-bot-api';
import { isAllowed } from './auth.js';
import {
  getSession,
  clearSession,
  isExpired,
} from './sessions.js';
import * as gemini from './gemini.js';
import { startBookingFlow, handleNewBookingMessage, handleNewBookingCallback } from './handlers/newBooking.js';
import {
  handleSupplierCommand,
  handlePaySupplierCommand,
  handleSupplierPayMessage,
  handleSupplierCallback,
  handleSupplierPayPickCallback,
} from './handlers/supplierLedger.js';
import {
  handlePartyCommand,
  handleReceivePaymentCommand,
  handlePartyPayMessage,
  handlePartyCallback,
} from './handlers/partyLedger.js';
import { handleProfitCommand, handleProfitCallback } from './handlers/reports.js';
import { handleSearchCommand } from './handlers/search.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

function matchCmd(text, name) {
  if (!text || typeof text !== 'string') return false;
  return new RegExp(`^/${name}(?:@\\w+)?(?:\\s|$)`, 'i').test(text.trim());
}

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;
  const doc = msg.document;
  if (!doc) return;
  if (doc.mime_type !== 'application/pdf') {
    await bot.sendMessage(chatId, 'Please send a *PDF* file.', { parse_mode: 'Markdown' });
    return;
  }
  try {
    await bot.sendMessage(chatId, '⏳ Downloading PDF…', { parse_mode: 'Markdown' });
    const fileLink = await bot.getFileLink(doc.file_id);
    const res = await fetch(fileLink);
    const buffer = Buffer.from(await res.arrayBuffer());
    await startBookingFlow(bot, chatId, buffer);
  } catch {
    await bot.sendMessage(chatId, 'Could not download that PDF. Try again.', {
      parse_mode: 'Markdown',
    });
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) return;
  if (msg.document) return;

  if (getSession(chatId) && isExpired(chatId)) {
    clearSession(chatId);
    await bot.sendMessage(
      chatId,
      'Session expired. Send a confirmation to start again.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const text = msg.text || '';
  const session = getSession(chatId);

  if (text.startsWith('/')) {
    const blocking =
      session?.flow === 'new_booking' &&
      !matchCmd(text, 'start') &&
      !matchCmd(text, 'newbooking');
    if (blocking) {
      await bot.sendMessage(
        chatId,
        'Please *Save*, *Edit*, or *Cancel* the booking in progress first.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (matchCmd(text, 'start')) {
      await bot.sendMessage(
        chatId,
        [
          '👋 *Welcome to Travelinsta Bot!*',
          '',
          'Send me a booking confirmation *PDF* or paste the text to create a new booking instantly.',
          '',
          '✈️ *Bookings*',
          '/newbooking — start a new booking',
          '',
          '💰 *Ledgers*',
          '/supplier [name] — what you owe a supplier',
          '/party [name] — what a party owes you',
          '/paysupplier — record payment to supplier',
          '/receivepayment — record payment from party',
          '',
          '📊 *Reports*',
          '/profit — profit summary',
          '/search [query] — find any booking',
          '',
          'You can also talk to me in *Hindi* or *English*!',
        ].join('\n'),
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (matchCmd(text, 'newbooking')) {
      await bot.sendMessage(
        chatId,
        '📎 Send a *PDF* confirmation or *paste* the full confirmation text here.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    if (matchCmd(text, 'supplier')) {
      await handleSupplierCommand(bot, msg);
      return;
    }
    if (matchCmd(text, 'party')) {
      await handlePartyCommand(bot, msg);
      return;
    }
    if (matchCmd(text, 'paysupplier')) {
      await handlePaySupplierCommand(bot, msg);
      return;
    }
    if (matchCmd(text, 'receivepayment')) {
      await handleReceivePaymentCommand(bot, msg);
      return;
    }
    if (matchCmd(text, 'profit')) {
      await handleProfitCommand(bot, chatId);
      return;
    }
    if (matchCmd(text, 'search')) {
      await handleSearchCommand(bot, msg);
      return;
    }
  }

  if (session?.flow === 'new_booking') {
    const steps = ['edit_wait', 'ask_party', 'ask_supplier', 'ask_invoice'];
    if (steps.includes(session.step)) {
      await handleNewBookingMessage(bot, msg, session);
      return;
    }
    if (text.trim()) {
      await bot.sendMessage(
        chatId,
        'Use the *inline buttons* for this step, or tap ✏️ *Edit*.',
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (session?.flow === 'pay_supplier') {
    if (session.step === 'ask_sup_name' || session.step === 'ask_amount' || session.step === 'ask_reference') {
      await handleSupplierPayMessage(bot, msg, session);
      return;
    }
    if (text.trim()) {
      await bot.sendMessage(chatId, 'Pick a *payment mode* from the buttons above.', {
        parse_mode: 'Markdown',
      });
    }
    return;
  }

  if (session?.flow === 'receive_payment') {
    const steps = ['ask_party_name', 'ask_pp_amount', 'ask_pp_ref'];
    if (steps.includes(session.step)) {
      await handlePartyPayMessage(bot, msg, session);
      return;
    }
    if (text.trim()) {
      await bot.sendMessage(
        chatId,
        'Choose an *invoice* or *mode* using the buttons.',
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  if (text.trim().length > 80 && !session) {
    await startBookingFlow(bot, chatId, text);
    return;
  }

  if (text.trim()) {
    try {
      const reply = await gemini.chat(text, chatId);
      try {
        await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
      } catch {
        await bot.sendMessage(chatId, reply);
      }
    } catch {
      await bot.sendMessage(chatId, 'Could not process that. Try again or use /newbooking.', {
        parse_mode: 'Markdown',
      });
    }
  }
});

bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat?.id;
  if (!chatId || !isAllowed(chatId)) {
    try {
      await bot.answerCallbackQuery(query.id);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    await bot.answerCallbackQuery(query.id);
  } catch {
    /* ignore */
  }

  const data = query.data || '';

  if (
    [
      'confirm_extracted',
      'edit_extracted',
      'save_booking',
      'edit_final',
      'cancel',
    ].includes(data) ||
    data === 'goto_newbooking'
  ) {
    if (data === 'goto_newbooking') {
      await bot.sendMessage(
        chatId,
        '📎 Send a *PDF* or paste confirmation text to start.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    await handleNewBookingCallback(bot, query);
    return;
  }

  if (data === 'profit_today' || data === 'profit_month' || data === 'profit_all') {
    await handleProfitCallback(bot, query);
    return;
  }

  if (data.startsWith('supsel:') || data.startsWith('ps_go:') || data.startsWith('ps_mode:')) {
    await handleSupplierCallback(bot, query);
    return;
  }
  if (data.startsWith('ps_pick:')) {
    await handleSupplierPayPickCallback(bot, query);
    return;
  }

  if (
    data.startsWith('ptyidx:') ||
    data === 'pp_go' ||
    data.startsWith('pp_mode:') ||
    data.startsWith('pp_inv:')
  ) {
    await handlePartyCallback(bot, query);
    return;
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('Travelinsta bot is running…');
