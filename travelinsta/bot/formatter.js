export function formatMoney(amount) {
  const n = Number(amount) || 0;
  const f = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `₹${f.format(n)}`;
}

function escMd(s) {
  return String(s || '').replace(/[`*_]/g, ' ');
}

function passengerList(data) {
  const list = [];
  if (Array.isArray(data.passengers)) {
    for (const p of data.passengers) {
      if (typeof p === 'string' && p.trim()) list.push(p.trim());
      else if (p && typeof p.name === 'string' && p.name.trim()) list.push(p.name.trim());
    }
  }
  if (data.hotel && Array.isArray(data.hotel.guests)) {
    for (const g of data.hotel.guests) {
      if (typeof g === 'string' && g.trim()) list.push(g.trim());
      else if (g && typeof g.name === 'string' && g.name.trim()) list.push(g.name.trim());
    }
  }
  if (data.tour && Array.isArray(data.tour.flights)) {
    for (const fl of data.tour.flights) {
      if (fl && Array.isArray(fl.passengers)) {
        for (const p of fl.passengers) {
          if (typeof p === 'string' && p.trim()) list.push(p.trim());
        }
      }
    }
  }
  return [...new Set(list)];
}

function line(label, value) {
  if (value === null || value === undefined) return '';
  const v = typeof value === 'string' ? value.trim() : value;
  if (v === '' || v === 'null') return '';
  return `${label}: ${escMd(v)}`;
}

export function formatExtracted(data) {
  const bt = (data.booking_type || 'other').toLowerCase();
  const pax = passengerList(data);
  const paxStr = pax.length ? pax.map(escMd).join(', ') : '';

  if (bt === 'flight') {
    const f = data.flight || {};
    const lines = [
      '✈️ *Flight Booking*',
      line('PNR', f.pnr),
      line('Airline', f.airline),
      line('Flight', f.flight_number),
      line('Route', f.origin && f.destination ? `${f.origin} → ${f.destination}` : f.route),
      line('Date', f.travel_date),
      f.departure_time && f.arrival_time
        ? `Times: ${escMd(f.departure_time)} → ${escMd(f.arrival_time)}`
        : [line('Departure', f.departure_time), line('Arrival', f.arrival_time)]
            .filter(Boolean)
            .join('\n') || '',
      line('Class', f.seat_class),
      line('Baggage', f.baggage),
      paxStr ? `Passengers: ${paxStr}` : '',
    ].filter(Boolean);
    return lines.join('\n') + '\n\nIs this correct?';
  }

  if (bt === 'hotel') {
    const h = data.hotel || {};
    const loc = [h.name, h.city].filter((x) => x && String(x).trim()).join(', ');
    const lines = [
      '🏨 *Hotel Booking*',
      loc ? `Hotel: ${escMd(loc)}` : '',
      line('Room', h.room_type),
      line('Meals', h.meal_plan),
      line('Check-in', h.check_in),
      line('Check-out', h.check_out),
      line('Nights', h.nights),
      paxStr ? `Guests: ${paxStr}` : '',
    ].filter(Boolean);
    return lines.join('\n') + '\n\nIs this correct?';
  }

  if (bt === 'tour_package') {
    const t = data.tour || {};
    const inc = Array.isArray(t.inclusions) ? t.inclusions.filter(Boolean).slice(0, 4) : [];
    const flights = Array.isArray(t.flights) ? t.flights : [];
    const hotels = Array.isArray(t.hotels) ? t.hotels : [];
    const hotelNames = hotels
      .map((x) => (x && x.name ? x.name : typeof x === 'string' ? x : null))
      .filter(Boolean);
    const lines = [
      '🌍 *Tour Package*',
      line('Destination', t.destination),
      t.start_date && t.end_date
        ? `Dates: ${escMd(t.start_date)} → ${escMd(t.end_date)}`
        : line('Start', t.start_date) + (t.end_date ? `\n${line('End', t.end_date)}` : ''),
      t.duration_nights != null && t.duration_days != null
        ? `Duration: ${escMd(t.duration_nights)}N / ${escMd(t.duration_days)}D`
        : '',
      `Flights: ${flights.length} leg(s)`,
      hotelNames.length ? `Hotels: ${hotelNames.map(escMd).join(', ')}` : '',
      inc.length ? `Includes: ${inc.map(escMd).join(', ')}` : '',
      paxStr ? `Travellers: ${paxStr}` : '',
    ].filter(Boolean);
    return lines.join('\n') + '\n\nIs this correct?';
  }

  if (bt === 'train') {
    const tr = data.train || {};
    const lines = [
      '🚂 *Train Booking*',
      line('PNR', tr.pnr),
      tr.train_number || tr.train_name
        ? `Train: ${escMd([tr.train_number, tr.train_name].filter(Boolean).join(' '))}`
        : '',
      line('Route', tr.origin && tr.destination ? `${tr.origin} → ${tr.destination}` : ''),
      line('Date', tr.travel_date),
      line('Departure', tr.departure_time),
      line('Class', tr.class),
      paxStr ? `Passengers: ${paxStr}` : '',
    ].filter(Boolean);
    return lines.join('\n') + '\n\nIs this correct?';
  }

  if (bt === 'bus') {
    const b = data.bus || {};
    const seats = Array.isArray(b.seat_numbers) ? b.seat_numbers.join(', ') : b.seat_numbers;
    const lines = [
      '🚌 *Bus Booking*',
      line('Operator', b.operator),
      line('Route', b.origin && b.destination ? `${b.origin} → ${b.destination}` : ''),
      line('Date', b.travel_date),
      line('Departure', b.departure_time),
      line('Seats', seats),
      paxStr ? `Passengers: ${paxStr}` : '',
    ].filter(Boolean);
    return lines.join('\n') + '\n\nIs this correct?';
  }

  const lines = ['📋 *Booking*', line('Type', bt), paxStr ? `Names: ${paxStr}` : ''].filter(Boolean);
  return lines.join('\n') + '\n\nIs this correct?';
}

function countPax(data) {
  const p = passengerList(data);
  return Math.max(p.length, 1);
}

export function generateInvoiceDescription(extracted) {
  const bt = (extracted.booking_type || 'other').toLowerCase();
  const n = countPax(extracted);

  if (bt === 'flight') {
    const f = extracted.flight || {};
    const route =
      f.origin && f.destination ? `${f.origin}-${f.destination}` : f.route || 'Flight';
    return `${route} | ${f.flight_number || '-'} | ${f.travel_date || '-'} | ${n} Pax`;
  }
  if (bt === 'hotel') {
    const h = extracted.hotel || {};
    return `${h.name || 'Hotel'} — ${h.room_type || '-'} | ${h.nights ?? '-'} Nights | ${h.check_in || '-'} to ${h.check_out || '-'}`;
  }
  if (bt === 'tour_package') {
    const t = extracted.tour || {};
    return `${t.destination || 'Tour'} Tour — ${t.duration_nights ?? '-'}N/${t.duration_days ?? '-'}D | ${t.start_date || '-'} to ${t.end_date || '-'} | ${n} Pax`;
  }
  if (bt === 'train') {
    const tr = extracted.train || {};
    const r = tr.origin && tr.destination ? `${tr.origin}-${tr.destination}` : 'Train';
    return `${r} | ${tr.train_number || ''} ${tr.train_name || ''} | ${tr.travel_date || '-'} | ${n} Pax`.replace(/\s+/g, ' ').trim();
  }
  if (bt === 'bus') {
    const b = extracted.bus || {};
    const r = b.origin && b.destination ? `${b.origin}-${b.destination}` : 'Bus';
    return `${r} | ${b.operator || '-'} | ${b.travel_date || '-'} | ${n} Pax`;
  }
  return `Booking | ${n} Pax`;
}

export function formatFinalSummary(session) {
  const party = escMd(session.party_name || '');
  const sup = escMd(session.supplier_name || '');
  const inv = Number(session.invoice_amount) || 0;
  const cost = Number(session.supplier_cost) || 0;
  const profit = Math.round((inv - cost) * 100) / 100;
  let profitEmoji = '⚠️';
  if (profit > 0) profitEmoji = '💰';
  if (profit < 0) profitEmoji = '🔴';
  const bt = (session.extracted?.booking_type || 'other').toLowerCase();
  const typeEmoji =
    bt === 'flight'
      ? '✈️'
      : bt === 'hotel'
        ? '🏨'
        : bt === 'tour_package'
          ? '🌍'
          : bt === 'train'
            ? '🚂'
            : bt === 'bus'
              ? '🚌'
              : '📋';
  const desc = escMd(session.invoice_description || generateInvoiceDescription(session.extracted || {}));
  const pax = passengerList(session.extracted || {});
  const paxLine = pax.length ? pax.map(escMd).join(', ') : '—';

  return (
    `─────────────────────────────────\n` +
    `${typeEmoji} *${desc}*\n` +
    `─────────────────────────────────\n` +
    `Party:    ${party}  →  ${formatMoney(inv)} *(you receive)*\n` +
    `Supplier: ${sup}  →  ${formatMoney(cost)} *(you owe)*\n` +
    `Passengers: ${paxLine}\n` +
    `─────────────────────────────────\n` +
    `Profit: ${formatMoney(profit)} ${profitEmoji}`
  );
}
