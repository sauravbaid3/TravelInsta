import supabase from './client.js';

function parseNum(v) {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function mapBookingRow(row) {
  if (!row) return null;
  return {
    ...row,
    supplier_cost: parseNum(row.supplier_cost),
    invoice_amount: parseNum(row.invoice_amount),
  };
}

export async function createBooking(data) {
  const payload = { ...data };
  if (payload.supplier_cost !== undefined) {
    payload.supplier_cost = Math.round(parseNum(payload.supplier_cost) * 100) / 100;
  }
  if (payload.invoice_amount !== undefined) {
    payload.invoice_amount = Math.round(parseNum(payload.invoice_amount) * 100) / 100;
  }
  const { data: row, error } = await supabase
    .from('bookings')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapBookingRow(row);
}

export async function getBookingById(id) {
  const { data: booking, error: eb } = await supabase
    .from('bookings')
    .select('*, suppliers(*)')
    .eq('id', id)
    .single();
  if (eb) throw eb;
  const { data: passengers, error: ep } = await supabase
    .from('passengers')
    .select('*')
    .eq('booking_id', id)
    .order('id', { ascending: true });
  if (ep) throw ep;
  const b = mapBookingRow(booking);
  b.passengers = passengers || [];
  if (b.suppliers) {
    b.supplier = b.suppliers;
    delete b.suppliers;
  }
  return b;
}

function sanitizeIlike(q) {
  return (q || '')
    .trim()
    .replace(/%/g, '')
    .replace(/,/g, ' ')
    .slice(0, 80);
}

export async function searchBookings(query) {
  const q = sanitizeIlike(query);
  if (!q) return [];
  const pattern = `%${q}%`;
  const { data: a, error: e1 } = await supabase
    .from('bookings')
    .select('*')
    .ilike('pnr', pattern)
    .limit(10);
  if (e1) throw e1;
  const { data: b, error: e2 } = await supabase
    .from('bookings')
    .select('*')
    .ilike('reference_number', pattern)
    .limit(10);
  if (e2) throw e2;
  const { data: c, error: e3 } = await supabase
    .from('bookings')
    .select('*')
    .ilike('party_name', pattern)
    .limit(10);
  if (e3) throw e3;
  const bookingMerge = new Map();
  for (const r of [...(a || []), ...(b || []), ...(c || [])]) {
    bookingMerge.set(r.id, r);
  }
  const byBooking = Array.from(bookingMerge.values());
  const { data: passRows, error: e4 } = await supabase
    .from('passengers')
    .select('booking_id, bookings(*)')
    .ilike('name', pattern)
    .limit(20);
  if (e4) throw e4;
  const map = new Map();
  for (const r of byBooking || []) {
    map.set(r.id, mapBookingRow(r));
  }
  for (const pr of passRows || []) {
    const bk = pr.bookings;
    if (bk && !map.has(bk.id)) {
      map.set(bk.id, mapBookingRow(bk));
    }
  }
  const list = Array.from(map.values()).slice(0, 5);
  for (const b of list) {
    const { data: pax, error: ep } = await supabase
      .from('passengers')
      .select('*')
      .eq('booking_id', b.id)
      .order('id', { ascending: true });
    if (ep) throw ep;
    b.passengers = pax || [];
  }
  return list;
}

export async function getBookingsBySupplier(supplierId) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data || []).map(mapBookingRow);
}

export async function getBookingsByParty(partyName) {
  const pattern = `%${(partyName || '').trim()}%`;
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .ilike('party_name', pattern)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapBookingRow);
}

export async function getBookingsInDateRange(startIso, endIso) {
  let q = supabase.from('bookings').select('*').order('created_at', { ascending: false });
  if (startIso) q = q.gte('created_at', startIso);
  if (endIso) q = q.lte('created_at', endIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(mapBookingRow);
}

export async function getDistinctPartiesMatching(pattern) {
  const p = `%${(pattern || '').trim()}%`;
  const { data, error } = await supabase
    .from('bookings')
    .select('party_name')
    .ilike('party_name', p)
    .limit(200);
  if (error) throw error;
  const set = new Set();
  for (const r of data || []) {
    if (r.party_name) set.add(r.party_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 12);
}

export async function getOpenBookingsForParty(exactPartyName) {
  const name = (exactPartyName || '').trim();
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('party_name', name)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  const { data: payments, error: ep } = await supabase
    .from('party_payments')
    .select('booking_id, amount')
    .eq('party_name', name);
  if (ep) throw ep;
  const paidByBooking = new Map();
  for (const pay of payments || []) {
    const bid = pay.booking_id;
    if (!bid) continue;
    paidByBooking.set(bid, (paidByBooking.get(bid) || 0) + parseNum(pay.amount));
  }
  const open = [];
  for (const b of bookings || []) {
    const inv = parseNum(b.invoice_amount);
    const paid = paidByBooking.get(b.id) || 0;
    const due = Math.round((inv - paid) * 100) / 100;
    if (due > 0.009) {
      open.push({ ...mapBookingRow(b), amount_paid: paid, amount_due: due });
    }
  }
  return open;
}
