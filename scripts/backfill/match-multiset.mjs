// One-to-one multiset matching between INCOMING discrete observations and
// EXISTING observations from the other channel, closest first.
//
// This is the exact transposition of matchXmlMultiset in
// src/lib/ingest/normalize-hae.ts, where the incoming side is the HAE batch
// being staged and the existing side is the XML history. Here the incoming
// side is whichever row set arrived second (fresh XML backfill rows in
// import-xml.mjs, the younger channel in dedup-channels.mjs). Keep the two
// implementations in sync: same grouping key (type|source|value_key), same
// match window, same closest-first order, same tie handling — a pair whose
// closest-first choice would be arbitrary is journalized as ambiguous and
// dropped, never resolved arbitrarily and never silently kept.
//
// MATCH WINDOW: ±1s, plus the HAE truncation rule. HAE truncates seconds to
// :00 for every raw type except heart_rate (docs/hae-mapping.md, measured),
// so an HAE point sitting exactly on a minute covers the whole minute it
// opens: it matches an XML timestamp in [ts_hae, ts_hae + 60s). Which side
// is the HAE channel is the caller's to say (haeSide), because the cleanup
// script matches in either direction depending on which channel reached the
// database first.
//
// Both sides carry ids as strings (observations.id is a bigint); the
// deterministic tie-break compares them numerically via length-then-lexico.

function cmpId(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function withinWindow(tsHae, tsXml) {
  if (Math.abs(tsXml - tsHae) <= 1000) return true;
  return tsHae % 60_000 === 0 && tsXml >= tsHae && tsXml - tsHae < 60_000;
}

/**
 * @param {Array<{id: string, typeId: number, sourceId: number, ts: number, valueKey: string}>} incoming
 * @param {Array<{id: string, typeId: number, sourceId: number, ts: number, valueKey: string}>} existing
 * @param {{haeSide: 'incoming' | 'existing'}} opts which side came through HAE
 * @returns {{matched: Set<string>, ambiguous: Set<string>}} ids of INCOMING rows
 */
export function matchMultiset(incoming, existing, { haeSide }) {
  const matched = new Set();
  const ambiguous = new Set();
  const byGroup = new Map();
  const keyOf = (r) => `${r.typeId}|${r.sourceId}|${r.valueKey}`;
  for (const s of incoming) {
    const g = byGroup.get(keyOf(s)) ?? { s: [], x: [] };
    g.s.push(s);
    byGroup.set(keyOf(s), g);
  }
  for (const x of existing) {
    const g = byGroup.get(keyOf(x));
    if (g) g.x.push(x);
  }
  for (const g of byGroup.values()) {
    if (g.x.length === 0) continue;
    const pairs = [];
    for (const s of g.s) {
      for (const x of g.x) {
        const [tsHae, tsXml] = haeSide === 'incoming' ? [s.ts, x.ts] : [x.ts, s.ts];
        if (withinWindow(tsHae, tsXml)) {
          pairs.push({ dt: Math.abs(s.ts - x.ts), sId: s.id, xId: x.id });
        }
      }
    }
    pairs.sort((a, b) => a.dt - b.dt || cmpId(a.sId, b.sId) || cmpId(a.xId, b.xId));
    const sUsed = new Set();
    const xUsed = new Set();
    for (const p of pairs) {
      if (sUsed.has(p.sId) || xUsed.has(p.xId) || ambiguous.has(p.sId)) continue;
      const ties = pairs.filter(
        (q) =>
          q !== p &&
          q.dt === p.dt &&
          (q.sId === p.sId || q.xId === p.xId) &&
          !sUsed.has(q.sId) &&
          !xUsed.has(q.xId) &&
          !ambiguous.has(q.sId)
      );
      if (ties.length > 0) {
        ambiguous.add(p.sId);
        for (const q of ties) ambiguous.add(q.sId);
        continue;
      }
      sUsed.add(p.sId);
      xUsed.add(p.xId);
      matched.add(p.sId);
    }
  }
  return { matched, ambiguous };
}
