import puppeteer from 'puppeteer';
import { formatMoney } from './formatter.js';

const PRIMARY = '#1a3c5e';
const BG = '#ffffff';
const ALT = '#f5f7fa';
const TEXT = '#333333';
const MUTED = '#666666';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(iso));
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function bookingTypeLabel(bt) {
  const m = {
    flight: '✈️ Flight',
    hotel: '🏨 Hotel',
    tour_package: '🌍 Tour Package',
    train: '🚂 Train',
    bus: '🚌 Bus',
    other: '📋 Other',
  };
  return m[bt] || m.other;
}

function rowsFromFlight(b) {
  return [
    ['Airline', b.airline],
    ['Flight Number', b.flight_number],
    ['Route', b.route || (b.origin && b.destination ? `${b.origin} → ${b.destination}` : null)],
    ['Date of Travel', b.travel_date],
    ['Departure', b.departure_time],
    ['Arrival', b.arrival_time],
    ['Class', b.seat_class],
    ['Baggage Allowance', b.baggage],
  ];
}

function rowsFromHotel(b) {
  return [
    ['Hotel Name', b.hotel_name],
    ['City', b.hotel_city],
    ['Room Type', b.room_type],
    ['Meal Plan', b.meal_plan],
    ['Check-in Date', b.check_in],
    ['Check-out Date', b.check_out],
    ['No. of Nights', b.nights],
  ];
}

function rowsFromTour(b) {
  let inc = b.inclusions;
  if (Array.isArray(inc)) inc = inc.join(', ');
  else if (inc && typeof inc === 'object') inc = JSON.stringify(inc);
  const dur =
    b.tour_start_date && b.tour_end_date
      ? `${fmtDate(b.tour_start_date)} – ${fmtDate(b.tour_end_date)}`
      : null;
  return [
    ['Destination', b.tour_destination],
    ['Start Date', b.tour_start_date],
    ['End Date', b.tour_end_date],
    ['Duration', dur],
    ['Inclusions', inc],
  ];
}

function rowsFromTrain(b) {
  return [
    ['Train Name', b.airline],
    ['Train Number', b.flight_number],
    ['Route', b.route || (b.origin && b.destination ? `${b.origin} → ${b.destination}` : null)],
    ['Date', b.travel_date],
    ['Departure Time', b.departure_time],
    ['Class', b.seat_class],
  ];
}

function rowsFromBus(b) {
  return [
    ['Operator', b.airline],
    ['Route', b.route || (b.origin && b.destination ? `${b.origin} → ${b.destination}` : null)],
    ['Date', b.travel_date],
    ['Departure', b.departure_time],
    ['Seats', b.baggage],
  ];
}

function detailRows(booking) {
  const bt = (booking.booking_type || 'other').toLowerCase();
  if (bt === 'flight') return rowsFromFlight(booking);
  if (bt === 'hotel') return rowsFromHotel(booking);
  if (bt === 'tour_package') return rowsFromTour(booking);
  if (bt === 'train') return rowsFromTrain(booking);
  if (bt === 'bus') return rowsFromBus(booking);
  return [
    ['Reference', booking.reference_number],
    ['Details', booking.invoice_description],
  ];
}

function tableHtml(rows) {
  const body = rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 12px;border:1px solid #ddd;background:${ALT};font-weight:600;width:32%;color:${TEXT};">${escapeHtml(k)}</td><td style="padding:10px 12px;border:1px solid #ddd;color:${TEXT};">${escapeHtml(String(v))}</td></tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">${body}</table>`;
}

export async function generateInvoicePDF(booking) {
  const ref =
    booking.pnr ||
    booking.reference_number ||
    String(booking.id);
  const passengers = Array.isArray(booking.passengers) ? booking.passengers : [];
  const paxRows = passengers
    .map(
      (p, i) =>
        `<tr><td style="padding:8px 12px;border:1px solid #ddd;">${i + 1}</td><td style="padding:8px 12px;border:1px solid #ddd;">${escapeHtml(p.name)}</td><td style="padding:8px 12px;border:1px solid #ddd;">${p.gender ? escapeHtml(p.gender) : '—'}</td></tr>`
    )
    .join('');
  const invAmt = formatMoney(booking.invoice_amount);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Invoice TI-${booking.id}</title></head>
<body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:${BG};color:${TEXT};font-size:14px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;">
    <div>
      <div style="font-size:28px;font-weight:800;color:${PRIMARY};letter-spacing:1px;">TRAVELINSTA</div>
      <div style="color:${MUTED};font-size:12px;margin-top:4px;">Your Trusted Travel Partner</div>
      <div style="margin-top:10px;font-size:12px;color:${TEXT};">New Delhi, India</div>
      <div style="font-size:12px;color:${TEXT};">Phone: +91-XXXXXXXXXX &nbsp; Email: info@travelinsta.in</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:700;color:${PRIMARY};">INVOICE</div>
      <div style="margin-top:8px;font-size:14px;">Invoice No: <strong>#TI-${booking.id}</strong></div>
      <div style="font-size:13px;margin-top:4px;">Date: ${fmtDate(booking.created_at)}</div>
      <div style="margin-top:10px;display:inline-block;background:#ff9800;color:#fff;padding:6px 14px;border-radius:999px;font-size:11px;font-weight:700;">UNPAID</div>
    </div>
  </div>
  <div style="height:3px;background:${PRIMARY};margin:8px 0 20px;"></div>
  <div style="display:flex;gap:12px;margin-bottom:20px;">
    <div style="flex:1;background:${ALT};padding:14px 16px;border-radius:8px;">
      <div style="font-size:11px;color:${MUTED};letter-spacing:0.5px;">BILLED TO</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;color:${PRIMARY};">${escapeHtml(booking.party_name)}</div>
    </div>
    <div style="flex:1;background:${ALT};padding:14px 16px;border-radius:8px;">
      <div style="font-size:11px;color:${MUTED};">BOOKING REFERENCE</div>
      <div style="font-weight:600;margin-top:4px;">${escapeHtml(ref)}</div>
      <div style="font-size:11px;color:${MUTED};margin-top:10px;">BOOKING TYPE</div>
      <div style="font-weight:600;">${escapeHtml(bookingTypeLabel(booking.booking_type))}</div>
      <div style="font-size:11px;color:${MUTED};margin-top:10px;">BOOKING DATE</div>
      <div style="font-weight:600;">${fmtDate(booking.created_at)}</div>
    </div>
  </div>
  <div style="font-size:12px;font-weight:700;color:${PRIMARY};letter-spacing:1px;margin:18px 0 8px;">BOOKING DETAILS</div>
  ${tableHtml(detailRows(booking))}
  <div style="font-size:12px;font-weight:700;color:${PRIMARY};letter-spacing:1px;margin:22px 0 8px;">PASSENGERS / GUESTS</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr style="background:${ALT};"><th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Sr. No</th><th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Name</th><th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Gender</th></tr>
    ${paxRows || `<tr><td colspan="3" style="padding:10px;border:1px solid #ddd;">—</td></tr>`}
  </table>
  <div style="font-size:12px;font-weight:700;color:${PRIMARY};letter-spacing:1px;margin:22px 0 8px;">INVOICE SUMMARY</div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:10px 12px;border:1px solid #ddd;background:${ALT};width:35%;">Description</td><td style="padding:10px 12px;border:1px solid #ddd;">${escapeHtml(booking.invoice_description || '')}</td></tr>
    <tr><td style="padding:10px 12px;border:1px solid #ddd;background:${ALT};">Amount</td><td style="padding:10px 12px;border:1px solid #ddd;font-weight:600;">${escapeHtml(invAmt)}</td></tr>
  </table>
  <div style="margin-top:4px;padding:14px 16px;background:${PRIMARY};color:#fff;font-size:16px;font-weight:700;display:flex;justify-content:space-between;border-radius:0 0 6px 6px;">
    <span>TOTAL AMOUNT DUE</span><span>${escapeHtml(invAmt)}</span>
  </div>
  <div style="margin-top:22px;background:${ALT};padding:16px 18px;border-radius:8px;">
    <div style="font-weight:700;color:${PRIMARY};margin-bottom:8px;">PAYMENT DETAILS</div>
    <div style="font-size:13px;line-height:1.7;">UPI ID: travelinsta@upi<br/>Bank: State Bank of India<br/>Account Name: Travelinsta<br/>Account No: XXXXXXXXXXXX<br/>IFSC: SBIN0XXXXXX</div>
  </div>
  <div style="margin-top:28px;padding-top:14px;border-top:2px solid ${PRIMARY};text-align:center;color:${MUTED};font-size:11px;line-height:1.6;">
    Thank you for choosing Travelinsta!<br/>
    For queries contact: info@travelinsta.in | +91-XXXXXXXXXX<br/>
    This is a computer-generated invoice.
  </div>
</body></html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
