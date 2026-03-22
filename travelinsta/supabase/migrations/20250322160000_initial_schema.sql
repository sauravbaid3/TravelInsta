-- Travelinsta initial schema (managed via Supabase CLI / Cursor Supabase plugin)

create table if not exists suppliers (
  id            bigint primary key generated always as identity,
  name          text not null,
  phone         text,
  upi_id        text,
  bank_details  text,
  notes         text,
  created_at    timestamptz default now()
);

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

create table if not exists passengers (
  id          bigint primary key generated always as identity,
  booking_id  bigint references bookings(id) on delete cascade,
  name        text not null,
  gender      text
);

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
