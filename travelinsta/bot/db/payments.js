import supabase from './client.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function createSupplierPayment({
  supplierId,
  bookingId,
  amount,
  paymentMode,
  reference,
  notes,
}) {
  const payload = {
    supplier_id: supplierId,
    booking_id: bookingId || null,
    amount: round2(amount),
    payment_mode: paymentMode || null,
    reference: reference || null,
    notes: notes || null,
  };
  const { data, error } = await supabase
    .from('supplier_payments')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createPartyPayment({
  bookingId,
  partyName,
  amount,
  paymentMode,
  reference,
  notes,
}) {
  const payload = {
    booking_id: bookingId,
    party_name: (partyName || '').trim(),
    amount: round2(amount),
    payment_mode: paymentMode || null,
    reference: reference || null,
    notes: notes || null,
  };
  const { data, error } = await supabase
    .from('party_payments')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createPassengers(bookingId, namesArray) {
  const names = Array.isArray(namesArray) ? namesArray : [];
  const rows = names
    .map((n) => (typeof n === 'string' ? n.trim() : String(n || '').trim()))
    .filter(Boolean)
    .map((name) => ({ booking_id: bookingId, name }));
  if (rows.length === 0) return [];
  const { data, error } = await supabase.from('passengers').insert(rows).select();
  if (error) throw error;
  return data || [];
}
