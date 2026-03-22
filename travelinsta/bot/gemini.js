import { GoogleGenerativeAI } from '@google/generative-ai';
import { createRequire } from 'module';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const lastCallByChat = new Map();
const MIN_INTERVAL_MS = 2000;

async function waitForSlot(chatId) {
  const id = String(chatId);
  const now = Date.now();
  const last = lastCallByChat.get(id) || 0;
  const wait = last + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallByChat.set(id, Date.now());
}

const SYSTEM_PARSE = `You are a travel booking confirmation parser for an Indian travel agency called Travelinsta.

STRICT RULES:
- Extract ONLY data explicitly written in the text.
- NEVER guess, invent, or assume any field.
- Use null for any field not found in the text.
- These four fields are ALWAYS null. Never extract them.
  They do not exist in any confirmation document:
    party_name
    supplier_name
    supplier_cost
    invoice_amount
- booking_type must be exactly one of:
    flight | hotel | tour_package | train | bus | other
- For tour_package: one confirmation may contain multiple
  flights and hotels. Capture all of them in arrays.
- All dates must be YYYY-MM-DD format.
- All times must be HH:MM 24-hour format.
- Return ONLY raw valid JSON. No markdown fences.
  No explanation. No extra text. Just the JSON object.

JSON structure to return:
{
  "booking_type": "",
  "reference_number": null,
  "passengers": [],
  "flight": {
    "pnr": null,
    "flight_number": null,
    "airline": null,
    "origin": null,
    "destination": null,
    "route": null,
    "travel_date": null,
    "departure_time": null,
    "arrival_time": null,
    "baggage": null,
    "seat_class": null
  },
  "hotel": {
    "name": null,
    "city": null,
    "room_type": null,
    "meal_plan": null,
    "check_in": null,
    "check_out": null,
    "nights": null,
    "guests": []
  },
  "tour": {
    "destination": null,
    "duration_days": null,
    "duration_nights": null,
    "start_date": null,
    "end_date": null,
    "inclusions": [],
    "exclusions": [],
    "flights": [],
    "hotels": [],
    "transfers": null,
    "sightseeing": null
  },
  "train": {
    "pnr": null,
    "train_number": null,
    "train_name": null,
    "origin": null,
    "destination": null,
    "travel_date": null,
    "departure_time": null,
    "arrival_time": null,
    "class": null
  },
  "bus": {
    "operator": null,
    "origin": null,
    "destination": null,
    "travel_date": null,
    "departure_time": null,
    "seat_numbers": []
  },
  "party_name": null,
  "supplier_name": null,
  "supplier_cost": null,
  "invoice_amount": null
}

Populate only the object matching booking_type.
Set all other type-specific objects to null defaults.`;

const SYSTEM_CHAT = `You are a helpful assistant for Travelinsta, an Indian
travel agency management system. Agents talk to you via
Telegram in Hindi, English, or Hinglish. Always reply in
the same language the agent uses. Keep replies short,
friendly, and action-oriented. Never invent booking data.

Domain knowledge:
- Supplier = person who paid for ticket upfront.
  Agency owes them.
- Party = client being billed. They owe the agency.
- Passengers = actual travellers. Not the same as party.
- Profit = invoice amount minus supplier cost.

Commands available:
/newbooking      start a new booking
/supplier [name] supplier balance
/party [name]    party balance
/paysupplier     record payment to supplier
/receivepayment  record payment from party
/profit          profit report
/search [query]  search bookings

If asked something outside your scope, suggest the
right command.`;

function getModel(systemInstruction) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-lite',
    systemInstruction,
  });
}

function stripJsonFences(text) {
  let t = (text || '').trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  return t.trim();
}

async function bufferToText(input) {
  if (Buffer.isBuffer(input)) {
    const res = await pdfParse(input);
    return (res.text || '').trim();
  }
  return String(input || '').trim();
}

export async function parseConfirmation(input, chatId = 'global') {
  await waitForSlot(chatId);
  const text = await bufferToText(input);
  if (!text || text.length < 5) {
    throw new Error('PARSE_FAILED');
  }
  const model = getModel(SYSTEM_PARSE);
  let raw;
  try {
    const result = await model.generateContent(text);
    raw = result.response.text();
  } catch (e) {
    throw new Error(e.message || 'GEMINI_ERROR');
  }
  const jsonStr = stripJsonFences(raw);
  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error('PARSE_FAILED');
  }
}

export async function chat(message, chatId = 'global') {
  await waitForSlot(chatId);
  const model = getModel(SYSTEM_CHAT);
  try {
    const result = await model.generateContent(String(message || ''));
    return result.response.text() || 'OK.';
  } catch {
    return 'Could not reply right now. Try a command like /newbooking.';
  }
}
