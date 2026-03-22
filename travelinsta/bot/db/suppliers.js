import supabase from './client.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function findSupplierByName(name) {
  const q = (name || '').trim();
  if (!q) return null;
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .ilike('name', `%${q}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function searchSuppliersByName(name) {
  const q = (name || '').trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .ilike('name', `%${q}%`)
    .order('name', { ascending: true })
    .limit(10);
  if (error) throw error;
  return data || [];
}

export async function createSupplier(name) {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({ name: (name || '').trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getSupplierById(id) {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function getSupplierBalance(supplierId) {
  const sid = Number(supplierId);
  const { data: bookingsRows, error: e1 } = await supabase
    .from('bookings')
    .select('supplier_cost')
    .eq('supplier_id', sid);
  if (e1) throw e1;
  const { data: payRows, error: e2 } = await supabase
    .from('supplier_payments')
    .select('amount')
    .eq('supplier_id', sid);
  if (e2) throw e2;
  let totalCost = 0;
  for (const r of bookingsRows || []) {
    totalCost += parseFloat(r.supplier_cost) || 0;
  }
  let totalPaid = 0;
  for (const r of payRows || []) {
    totalPaid += parseFloat(r.amount) || 0;
  }
  totalCost = round2(totalCost);
  totalPaid = round2(totalPaid);
  const balance = round2(totalCost - totalPaid);
  return { totalCost, totalPaid, balance };
}

export async function getSupplierStatement(supplierId) {
  const sid = Number(supplierId);
  const { data: bookings, error: eb } = await supabase
    .from('bookings')
    .select('*')
    .eq('supplier_id', sid)
    .order('created_at', { ascending: false })
    .limit(5);
  if (eb) throw eb;
  const { data: payments, error: ep } = await supabase
    .from('supplier_payments')
    .select('*')
    .eq('supplier_id', sid)
    .order('paid_at', { ascending: false });
  if (ep) throw ep;
  const bookingItems = (bookings || []).map((b) => ({
    kind: 'booking',
    date: b.created_at,
    invoice_description: b.invoice_description,
    amount: round2(parseFloat(b.supplier_cost) || 0),
    booking_id: b.id,
  }));
  const paymentItems = (payments || []).map((p) => ({
    kind: 'payment',
    date: p.paid_at,
    reference: p.reference,
    payment_mode: p.payment_mode,
    amount: round2(parseFloat(p.amount) || 0),
    booking_id: p.booking_id,
  }));
  const merged = [...bookingItems, ...paymentItems].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  return { recentBookings: bookings || [], payments: payments || [], timeline: merged };
}
