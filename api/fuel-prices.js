// GET /api/fuel-prices?fuel=e5&radius=5
//
// Ruft Tankerkönig serverseitig auf — der Key bleibt hier, das Frontend
// sieht ihn nie. Ohne gesetzten Key liefert die Route ehrlich 503, statt
// erfundene Preise zu zeigen.
//
// Koordinaten fix auf Erbach (Odenwald) gesetzt, da diese Route zur
// bestehenden Ein-Stadt-Seite gehört.

const LAT = 49.6558;
const LON = 8.9944;
const ALLOWED_FUEL = new Set(['e5', 'e10', 'diesel']);

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

  // Eingaben validieren und hart begrenzen
  const fuel = ALLOWED_FUEL.has(String(req.query?.fuel)) ? String(req.query.fuel) : 'e5';
  const radius = Math.min(10, Math.max(1, parseInt(req.query?.radius, 10) || 5));

  const url =
    `https://creativecommons.tankerkoenig.de/json/list.php?lat=${LAT}&lng=${LON}` +
    `&rad=${radius}&sort=price&type=${fuel}&apikey=${key}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const apiRes = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!apiRes.ok) throw new Error('HTTP ' + apiRes.status);
    const data = await apiRes.json();
    if (!data.ok) throw new Error('api_error');

    const stations = (data.stations || []).slice(0, 10).map((s) => ({
      name: s.brand || s.name || 'Tankstelle',
      price: s.price,
      distKm: s.dist,
      street: [s.street, s.houseNumber].filter(Boolean).join(' '),
      place: s.place,
      isOpen: s.isOpen,
    }));

    // 5 Minuten Edge-Cache: schont das Rate-Limit, egal wie viele Besucher laden
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=300');
    return res.status(200).json({
      ok: true,
      fuel,
      radiusKm: radius,
      stations,
      attribution: 'Daten: Tankerkönig / MTS-K, Lizenz CC BY 4.0',
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'source_unavailable' });
  }
}
