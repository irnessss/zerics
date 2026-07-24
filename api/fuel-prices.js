// GET /api/fuel-prices?radius=5[&lat=..&lng=..]
//
// Holt ALLE drei Kraftstoffsorten mit EINEM Aufruf (type=all).
// Grund: Tankerkönig erlaubt nur ~1 Request pro Minute je API-Key und
// empfiehlt ausdrücklich, Preise gebündelt zu holen statt einzeln.
// Das Umschalten zwischen E5/E10/Diesel passiert deshalb im Browser,
// ohne neue Anfrage.
//
// Weitere Schonung der Quelle:
// - Edge-Cache 5 Minuten (Tankerkönig aktualisiert selbst nur alle 4-5 Min.)
// - Koordinaten auf 2 Nachkommastellen gerundet (~1 km): weniger
//   unterschiedliche Cache-Schlüssel, dadurch deutlich weniger Abfragen,
//   und gleichzeitig besserer Schutz der Privatsphäre der Besucher
// - Radius hart auf 1-15 km begrenzt (erlaubt wären 25)
//
// Es werden keine Koordinaten gespeichert oder geloggt.
// Der API-Key bleibt serverseitig und taucht in keiner Antwort auf.

const DEFAULT_LAT = 49.6558;   // Erbach (Odenwald)
const DEFAULT_LON = 8.9944;
const FUELS = ['e5', 'e10', 'diesel'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const key = process.env.TANKERKOENIG_API_KEY;
  if (!key) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const radius = Math.min(15, Math.max(1, parseInt(req.query?.radius, 10) || 5));
  const { lat, lon, custom } = parseCoords(req.query?.lat, req.query?.lng);

  const url =
    `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lon}` +
    `&rad=${radius}&sort=dist&type=all&apikey=${key}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const apiRes = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);

    if (apiRes.status === 429) throw new Error('rate_limited');
    if (!apiRes.ok) throw new Error('HTTP ' + apiRes.status);

    const data = await apiRes.json();
    if (!data.ok) throw new Error('api_error');

    // Alle Sorten pro Station mitgeben; sortiert wird im Frontend.
    const stations = (data.stations || [])
      .slice(0, 25)
      .map((s) => ({
        name: s.brand || s.name || 'Tankstelle',
        street: [s.street, s.houseNumber].filter(Boolean).join(' '),
        place: s.place || '',
        distKm: s.dist,
        isOpen: Boolean(s.isOpen),
        prices: {
          e5: numOrNull(s.e5),
          e10: numOrNull(s.e10),
          diesel: numOrNull(s.diesel),
        },
      }))
      // Stationen ohne jeden Preis sind für die Anzeige wertlos
      .filter((s) => FUELS.some((f) => s.prices[f] != null));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      ok: true,
      radiusKm: radius,
      usedLocation: custom ? 'user' : 'erbach',
      stations,
      attribution: 'Daten: Tankerkönig / MTS-K, Lizenz CC BY 4.0',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    const code =
      err?.name === 'AbortError' ? 'timeout' :
      err?.message === 'rate_limited' ? 'rate_limited' :
      'source_unavailable';
    return res.status(502).json({ ok: false, error: code });
  }
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseCoords(rawLat, rawLon) {
  const la = Number(rawLat);
  const lo = Number(rawLon);
  const valid =
    Number.isFinite(la) && Number.isFinite(lo) &&
    la >= -90 && la <= 90 && lo >= -180 && lo <= 180;

  if (!valid) return { lat: DEFAULT_LAT, lon: DEFAULT_LON, custom: false };

  // auf ~1 km runden
  return { lat: Math.round(la * 100) / 100, lon: Math.round(lo * 100) / 100, custom: true };
}
