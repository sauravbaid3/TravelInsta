import * as gemini from '../gemini.js';
import {
  formatExtracted,
  formatFinalSummary,
  formatMoney,
  generateInvoiceDescription,
} from '../formatter.js';
import { getSession, updateSession, setSession, clearSession } from '../sessions.js';
import { createBooking, getBookingById } from '../db/bookings.js';
import { findSupplierByName, createSupplier } from '../db/suppliers.js';
import { createPassengers } from '../db/payments.js';
import { generateInvoicePDF } from '../invoiceGenerator.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const SUPPLIER_LINE = /^(.+?)[\s,]+(\d+(?:\.\d+)?)\s*$/;

async function inputToOriginalString(input) {
  if (Buffer.isBuffer(input)) {
    const res = await pdfParse(input);
    return (res.text || '').trim().slice(0, 12000);
  }
  return String(input || '').trim().slice(0, 12000);
}

function collectPassengerNames(extracted) {
  const map = new Map();
  const add = (raw) => {
    const t = String(raw || '').trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (!map.has(key)) map.set(key, t);
  };
  if (extracted && Array.isArray(extracted.passengers)) {
    for (const p of extracted.passengers) {
      if (typeof p === 'string') add(p);
      else if (p && typeof p.name === 'string') add(p.name);
    }
  }
  const hotel = extracted?.hotel;
  if (hotel && Array.isArray(hotel.guests)) {
    for (const g of hotel.guests) {
      if (typeof g === 'string') add(g);
      else if (g && typeof g.name === 'string') add(g.name);
    }
  }
  const tour = extracted?.tour;
  if (tour && Array.isArray(tour.flights)) {
    for (const fl of tour.flights) {
      if (fl && Array.isArray(fl.passengers)) {
        for (const p of fl.passengers) add(p);
      }
    }
  }
  return Array.from(map.values());
}

function mapExtractedToBookingRow(session) {
  const e = session.extracted || {};
  const bt = (e.booking_type || 'flight').toLowerCase();
  const row = {
    booking_type: bt,
    reference_number: e.reference_number || null,
    party_name: session.party_name,
    supplier_id: session.supplier_id,
    supplier_cost: Math.round(Number(session.supplier_cost) * 100) / 100,
    invoice_amount: Math.round(Number(session.invoice_amount) * 100) / 100,
    invoice_description: session.invoice_description,
    raw_extracted: e,
  };

  if (bt === 'flight') {
    const f = e.flight || {};
    Object.assign(row, {
      pnr: f.pnr,
      flight_number: f.flight_number,
      airline: f.airline,
      origin: f.origin,
      destination: f.destination,
      route: f.route,
      travel_date: f.travel_date,
      departure_time: f.departure_time,
      arrival_time: f.arrival_time,
      baggage: f.baggage,
      seat_class: f.seat_class,
    });
  } else if (bt === 'hotel') {
    const h = e.hotel || {};
    Object.assign(row, {
      hotel_name: h.name,
      hotel_city: h.city,
      room_type: h.room_type,
      meal_plan: h.meal_plan,
      check_in: h.check_in,
      check_out: h.check_out,
      nights: h.nights != null ? parseInt(h.nights, 10) || null : null,
    });
  } else if (bt === 'tour_package') {
    const t = e.tour || {};
    Object.assign(row, {
      tour_destination: t.destination,
      tour_start_date: t.start_date,
      tour_end_date: t.end_date,
      inclusions: Array.isArray(t.inclusions) ? t.inclusions : null,
    });
    const f0 = Array.isArray(t.flights) && t.flights[0] ? t.flights[0] : {};
    const h0 = Array.isArray(t.hotels) && t.hotels[0] ? t.hotels[0] : {};
    Object.assign(row, {
      pnr: f0.pnr,
      flight_number: f0.flight_number,
      airline: f0.airline,
      origin: f0.origin,
      destination: f0.destination,
      route: f0.route,
      travel_date: f0.travel_date,
      departure_time: f0.departure_time,
      arrival_time: f0.arrival_time,
      baggage: f0.baggage,
      seat_class: f0.seat_class,
      hotel_name: h0.name || (typeof h0 === 'string' ? h0 : null),
      hotel_city: h0.city,
      room_type: h0.room_type,
      meal_plan: h0.meal_plan,
      check_in: h0.check_in,
      check_out: h0.check_out,
      nights: h0.nights != null ? parseInt(h0.nights, 10) || null : null,
    });
  } else if (bt === 'train') {
    const tr = e.train || {};
    Object.assign(row, {
      pnr: tr.pnr,
      flight_number: tr.train_number,
      airline: tr.train_name,
      origin: tr.origin,
      destination: tr.destination,
      route: tr.origin && tr.destination ? `${tr.origin} → ${tr.destination}` : null,
      travel_date: tr.travel_date,
      departure_time: tr.departure_time,
      arrival_time: tr.arrival_time,
      seat_class: tr.class,
    });
  } else if (bt === 'bus') {
    const b = e.bus || {};
    const seats = Array.isArray(b.seat_numbers) ? b.seat_numbers.join(', ') : null;
    Object.assign(row, {
      airline: b.operator,
      origin: b.origin,
      destination: b.destination,
      route: b.origin && b.destination ? `${b.origin} → ${b.destination}` : null,
      travel_date: b.travel_date,
      departure_time: b.departure_time,
      baggage: seats,
    });
  }
  return row;
}

export async function startBookingFlow(bot, chatId, input) {
  await bot.sendMessage(chatId, '⏳ Reading your confirmation...', {
    parse_mode: 'Markdown',
  });
  try {
    const originalText = await inputToOriginalString(input);
    const result = await gemini.parseConfirmation(input, chatId);
    setSession(chatId, {
      flow: 'new_booking',
      step: 'confirm_extracted',
      extracted: result,
      original_text: originalText || String(input || '').slice(0, 12000),
    });
    const text = formatExtracted(result);
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Correct', callback_data: 'confirm_extracted' },
            { text: '✏️ Edit', callback_data: 'edit_extracted' },
          ],
        ],
      },
    });
  } catch (err) {
    if (err.message === 'PARSE_FAILED') {
      await bot.sendMessage(
        chatId,
        '❌ Could not read that confirmation. Try pasting the plain text.',
        { parse_mode: 'Markdown' }
      );
    } else {
      await bot.sendMessage(
        chatId,
        '❌ Could not read that. Please paste the confirmation text or send a clearer PDF.',
        { parse_mode: 'Markdown' }
      );
    }
  }
}

export async function handleNewBookingMessage(bot, msg, session) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const step = session.step;

  if (step === 'edit_wait') {
    const base = session.original_text || '';
    const combined = base ? `${base}\n${text}` : text;
    try {
      const result = await gemini.parseConfirmation(combined, chatId);
      updateSession(chatId, {
        step: 'confirm_extracted',
        extracted: result,
        original_text: combined.slice(0, 12000),
      });
      await bot.sendMessage(chatId, formatExtracted(result), {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Correct', callback_data: 'confirm_extracted' },
              { text: '✏️ Edit', callback_data: 'edit_extracted' },
            ],
          ],
        },
      });
    } catch (e) {
      if (e.message === 'PARSE_FAILED') {
        await bot.sendMessage(
          chatId,
          'Could not read that confirmation. Try pasting the plain text.',
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(chatId, 'Could not process that. Try again.', {
          parse_mode: 'Markdown',
        });
      }
    }
    return;
  }

  if (step === 'ask_party') {
    updateSession(chatId, { party_name: text, step: 'ask_supplier' });
    await bot.sendMessage(
      chatId,
      '💳 *Who floated the money for this booking?*\nReply as: *Name, Amount*\nExample: _Ramesh bhai, 8400_',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (step === 'ask_supplier') {
    const m = text.match(SUPPLIER_LINE);
    if (!m) {
      await bot.sendMessage(
        chatId,
        'Please reply as: *Name, Amount*\nExample: _Ramesh bhai, 8400_',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    const name = m[1].trim();
    const cost = Math.round(parseFloat(m[2]) * 100) / 100;
    let supplier = await findSupplierByName(name);
    if (!supplier) {
      try {
        supplier = await createSupplier(name);
      } catch {
        await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
          parse_mode: 'Markdown',
        });
        return;
      }
    }
    const party = getSession(chatId)?.party_name || session.party_name;
    updateSession(chatId, {
      supplier_name: supplier.name,
      supplier_id: supplier.id,
      supplier_cost: cost,
      step: 'ask_invoice',
    });
    await bot.sendMessage(
      chatId,
      `🧾 *What will you charge ${party || 'the party'}?*\n_(Amount to put on their invoice)_`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (step === 'ask_invoice') {
    const cleaned = text.replace(/₹/g, '').replace(/,/g, '').trim();
    const amt = parseFloat(cleaned);
    if (Number.isNaN(amt)) {
      await bot.sendMessage(chatId, 'Please enter a number. Example: _9500_', {
        parse_mode: 'Markdown',
      });
      return;
    }
    const invoice_amount = Math.round(amt * 100) / 100;
    const cur = getSession(chatId) || session;
    const invoice_description = generateInvoiceDescription(cur.extracted || {});
    const profit = Math.round((invoice_amount - Number(cur.supplier_cost || 0)) * 100) / 100;
    updateSession(chatId, {
      invoice_amount,
      invoice_description,
      step: 'final_confirm',
    });
    const merged = { ...getSession(chatId) };
    await bot.sendMessage(chatId, formatFinalSummary(merged), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💾 Save & Generate Invoice', callback_data: 'save_booking' }],
          [
            { text: '✏️ Edit', callback_data: 'edit_final' },
            { text: '❌ Cancel', callback_data: 'cancel' },
          ],
        ],
      },
    });
  }
}

export async function handleNewBookingCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = getSession(chatId);
  if (!session || session.flow !== 'new_booking') return;

  if (data === 'confirm_extracted') {
    updateSession(chatId, { step: 'ask_party' });
    await bot.sendMessage(
      chatId,
      '🏢 *Who is this booking for?*\n_(Party name — the client you are billing)_',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (data === 'edit_extracted') {
    updateSession(chatId, { step: 'edit_wait' });
    await bot.sendMessage(chatId, 'Tell me what to correct and I will re-parse.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  if (data === 'edit_final') {
    updateSession(chatId, { step: 'ask_party' });
    await bot.sendMessage(
      chatId,
      "Let's redo the details. Who is this booking for?",
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (data === 'cancel') {
    clearSession(chatId);
    await bot.sendMessage(chatId, 'Cancelled. Nothing was saved.', { parse_mode: 'Markdown' });
    return;
  }

  if (data === 'save_booking') {
    await bot.sendMessage(chatId, '⏳ Saving booking and generating invoice...', {
      parse_mode: 'Markdown',
    });
    const s = getSession(chatId);
    if (!s || !s.extracted || !s.party_name || !s.supplier_id) {
      await bot.sendMessage(chatId, 'Session incomplete. Start again with /newbooking.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    let booking;
    try {
      const row = mapExtractedToBookingRow(s);
      booking = await createBooking(row);
      const names = collectPassengerNames(s.extracted);
      await createPassengers(booking.id, names);
    } catch {
      await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    let full;
    try {
      full = await getBookingById(booking.id);
    } catch {
      await bot.sendMessage(chatId, 'Something went wrong saving. Try again.', {
        parse_mode: 'Markdown',
      });
      return;
    }
    let pdfBuffer;
    try {
      pdfBuffer = await generateInvoicePDF(full);
    } catch {
      await bot.sendMessage(chatId, 'Booking saved but PDF failed. Retry from search later.', {
        parse_mode: 'Markdown',
      });
      clearSession(chatId);
      return;
    }
    const partySafe = String(s.party_name).replace(/\s+/g, '_');
    const profit =
      Math.round((Number(s.invoice_amount) - Number(s.supplier_cost)) * 100) / 100;
    const caption =
      '✅ *Booking saved!*\n\n' +
      `Booking ID: \`#TI-${booking.id}\`\n` +
      `Invoice: ${s.party_name} — ${formatMoney(s.invoice_amount)} ✅\n` +
      `Supplier: ${s.supplier_name} — ${formatMoney(s.supplier_cost)} 🔴 pending\n\n` +
      `Profit: ${formatMoney(profit)} 💰\n\n` +
      '_Forward this invoice directly to your customer._';
    await bot.sendDocument(
      chatId,
      pdfBuffer,
      {
        filename: `Invoice_TI-${booking.id}_${partySafe}.pdf`,
        contentType: 'application/pdf',
      },
      { caption, parse_mode: 'Markdown' }
    );
    await bot.sendMessage(chatId, 'What next?', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ New Booking', callback_data: 'goto_newbooking' }],
          [{ text: '📊 Profit Report', callback_data: 'profit_today' }],
        ],
      },
    });
    clearSession(chatId);
  }
}
