/**
 * Normalize passengers/guests from Gemini extraction: dedupe by name (case-insensitive), keep gender when present.
 */
function addPassenger(map, name, gender) {
  const t = String(name || '').trim();
  if (!t) return;
  const key = t.toLowerCase();
  const g =
    gender != null && String(gender).trim() ? String(gender).trim() : null;
  if (!map.has(key)) {
    map.set(key, { name: t, gender: g });
  } else if (g && !map.get(key).gender) {
    map.get(key).gender = g;
  }
}

function ingestPassengerArray(map, arr) {
  if (!Array.isArray(arr)) return;
  for (const p of arr) {
    if (typeof p === 'string') addPassenger(map, p, null);
    else if (p && typeof p === 'object' && typeof p.name === 'string') {
      addPassenger(map, p.name, p.gender);
    }
  }
}

export function collectPassengers(extracted) {
  const map = new Map();
  if (extracted && Array.isArray(extracted.passengers)) {
    ingestPassengerArray(map, extracted.passengers);
  }
  const hotel = extracted?.hotel;
  if (hotel && Array.isArray(hotel.guests)) {
    ingestPassengerArray(map, hotel.guests);
  }
  const tour = extracted?.tour;
  if (tour && Array.isArray(tour.flights)) {
    for (const fl of tour.flights) {
      if (fl && Array.isArray(fl.passengers)) {
        ingestPassengerArray(map, fl.passengers);
      }
    }
  }
  return Array.from(map.values());
}
