# Travelinsta

Travel agency management for Indian agencies: a **Telegram bot** for agents to log bookings, run **supplier** and **party** ledgers, and generate **professional PDF invoices** (customer-facing — no supplier cost or profit on the PDF).

## Requirements

- Node.js 18+
- A [Telegram Bot](https://core.telegram.org/bots/tutorial) token
- [Google AI Studio](https://aistudio.google.com/) API key (Gemini)
- A [Supabase](https://supabase.com/) project (free tier is fine)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (optional but recommended — also installed as a dev dependency via `npm install`)

## Cursor: Supabase MCP

The repo includes **`.cursor/mcp.json`** (same URL the Cursor Supabase plugin uses) so the agent can call official Supabase MCP tools (`list_tables`, `apply_migration`, `execute_sql`, etc.).

1. **Workspace root:** Open the folder that contains `.cursor` (either `travelinsta` or the parent repo, depending on how you cloned it).
2. In Cursor go to **Settings → Cursor Settings → Tools & MCP** and confirm **`supabase`** is listed.
3. When prompted, **sign in to Supabase** in the browser (OAuth). If nothing appears, use **Developer: Reload Window** from the Command Palette.

**Optional — lock to one project** (recommended): edit `.cursor/mcp.json` and change the URL to:

`https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF`

Your **project ref** is in the Supabase dashboard under **Project Settings → General**. For read-only SQL, add `&read_only=true`.

Docs: [Supabase MCP](https://supabase.com/docs/guides/getting-started/mcp).

## Setup

1. Clone or copy this folder and install dependencies:

   ```bash
   cd travelinsta
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in:

   - `TELEGRAM_BOT_TOKEN` — from BotFather
   - `GEMINI_API_KEY` — from Google AI Studio
   - `ALLOWED_CHAT_IDS` — comma-separated Telegram user/chat IDs (only these chats can use the bot)
   - `SUPABASE_URL` — Project URL
   - `SUPABASE_SERVICE_KEY` — **Service role** key (not anon). The bot enforces access via `ALLOWED_CHAT_IDS`.

3. **Database schema — use the Supabase plugin or CLI (recommended)**

   This repo includes a standard **`supabase/`** folder (from `supabase init`) so the **Cursor Supabase plugin** and **Supabase CLI** can manage your project.

   - **Cursor Supabase plugin**: Link your Supabase project in the plugin, then use it to inspect tables, run SQL, **apply migrations**, generate TypeScript types, and view logs. Migrations live in `supabase/migrations/` (start with `20250322160000_initial_schema.sql`).
   - **CLI (remote project)**:

     ```bash
     npx supabase login
     npx supabase link --project-ref <your-project-ref>
     npm run db:push
     ```

     (`db:push` applies local migrations to the linked cloud project.)

   - **CLI (local stack)** — optional, for full local Postgres + API:

     ```bash
     npm run db:start
     ```

   - **Generate DB types** (after `supabase link`):

     ```bash
     npm run db:types
     ```

     Output: `types/database.types.ts` (use in editors or future TypeScript code).

   **Alternative:** run the SQL in the **Supabase SQL Editor** once (same statements as in `supabase/migrations/20250322160000_initial_schema.sql`).

4. Start the bot:

   ```bash
   npm start
   ```

The bot uses **polling** (no webhooks). Keep the process running on a server or your machine.

## Supabase schema (reference)

The canonical migration file is `supabase/migrations/20250322160000_initial_schema.sql`. You can also run the equivalent SQL manually in the SQL Editor:

```sql
-- suppliers
create table if not exists suppliers (
  id            bigint primary key generated always as identity,
  name          text not null,
  phone         text,
  upi_id        text,
  bank_details  text,
  notes         text,
  created_at    timestamptz default now()
);

-- bookings
create table if not exists bookings (
  id                   bigint primary key generated always as identity,
  booking_type         text not null default 'flight',
  reference_number     text,
  party_name           text not null,
  supplier_id          bigint references suppliers(id),
  supplier_cost        numeric(12,2) not null default 0,
  invoice_amount       numeric(12,2) not null default 0,
  invoice_description  text,
  pnr                  text,
  flight_number        text,
  airline              text,
  origin               text,
  destination          text,
  route                text,
  travel_date          date,
  departure_time       text,
  arrival_time         text,
  baggage              text,
  seat_class           text,
  hotel_name           text,
  hotel_city           text,
  room_type            text,
  meal_plan            text,
  check_in             date,
  check_out            date,
  nights               integer,
  tour_destination     text,
  tour_start_date      date,
  tour_end_date        date,
  inclusions           jsonb,
  raw_extracted        jsonb,
  created_at           timestamptz default now()
);

-- passengers
create table if not exists passengers (
  id          bigint primary key generated always as identity,
  booking_id  bigint references bookings(id) on delete cascade,
  name        text not null,
  gender      text
);

-- supplier_payments (agency pays supplier)
create table if not exists supplier_payments (
  id            bigint primary key generated always as identity,
  supplier_id   bigint references suppliers(id),
  booking_id    bigint references bookings(id),
  amount        numeric(12,2) not null,
  payment_mode  text,
  reference     text,
  paid_at       timestamptz default now(),
  notes         text
);

-- party_payments (party pays agency)
create table if not exists party_payments (
  id            bigint primary key generated always as identity,
  booking_id    bigint references bookings(id),
  party_name    text not null,
  amount        numeric(12,2) not null,
  payment_mode  text,
  reference     text,
  paid_at       timestamptz default now(),
  notes         text
);
```

## Bot commands

| Command | Action |
|--------|--------|
| `/start` | Welcome and help |
| `/newbooking` | Start booking (PDF or long pasted text) |
| `/supplier [name]` | Supplier balance and recent bookings |
| `/party [name]` | Party balance and recent invoices |
| `/paysupplier` | Record payment to a supplier |
| `/receivepayment` | Record payment from a party |
| `/profit` | Profit report (today / month / all time) |
| `/search [query]` | Search by PNR, reference, party, passenger |

## Domain model (short)

- **Supplier** — floated money for the booking; the agency owes them.
- **Party** — client being invoiced; they owe the agency.
- **Passengers** — travellers; names may appear on the confirmation; they are not the party.

Confirmation documents do **not** contain party name, supplier name, supplier cost, or invoice amount — the bot asks for these after parsing.

## License

Private / use as you wish for your agency.
