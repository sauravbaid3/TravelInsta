import supabase from './client.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getPartyBalance(partyName) {
  const pattern = `%${(partyName || '').trim()}%`;
  const { data: bookings, error: eb } = await supabase
    .from('bookings')
    .select('invoice_amount')
    .ilike('party_name', pattern);
  if (eb) throw eb;
  const { data: payments, error: ep } = await supabase
    .from('party_payments')
    .select('amount')
    .ilike('party_name', pattern);
  if (ep) throw ep;
  let totalInvoiced = 0;
  for (const r of bookings || []) {
    totalInvoiced += parseNum(r.invoice_amount);
  }
  let totalReceived = 0;
  for (const r of payments || []) {
    totalReceived += parseNum(r.amount);
  }
  totalInvoiced = round2(totalInvoiced);
  totalReceived = round2(totalReceived);
  const balance = round2(totalInvoiced - totalReceived);
  return { totalInvoiced, totalReceived, balance };
}

export async function getPartyStatement(partyName) {
  const pattern = `%${(partyName || '').trim()}%`;
  const { data: bookings, error: eb } = await supabase
    .from('bookings')
    .select('*')
    .ilike('party_name', pattern)
    .order('created_at', { ascending: false })
    .limit(5);
  if (eb) throw eb;
  const { data: payments, error: ep } = await supabase
    .from('party_payments')
    .select('*')
    .ilike('party_name', pattern)
    .order('paid_at', { ascending: false });
  if (ep) throw ep;
  const bookingItems = (bookings || []).map((b) => ({
    kind: 'invoice',
    date: b.created_at,
    invoice_description: b.invoice_description,
    amount: round2(parseNum(b.invoice_amount)),
    booking_id: b.id,
  }));
  const paymentItems = (payments || []).map((p) => ({
    kind: 'payment',
    date: p.paid_at,
    reference: p.reference,
    payment_mode: p.payment_mode,
    amount: round2(parseNum(p.amount)),
    booking_id: p.booking_id,
  }));
  const timeline = [...bookingItems, ...paymentItems].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  return { recentBookings: bookings || [], payments: payments || [], timeline };
}
