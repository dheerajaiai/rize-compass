// Deterministic PRNG so the whole pipeline (generate -> decisions -> validate)
// is reproducible: same seed always produces the same synthetic dataset.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weightedChoice(rng, items) {
  // items: [{key, weight}]
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    if (r < item.weight) return item.key;
    r -= item.weight;
  }
  return items[items.length - 1].key;
}

export function bernoulli(rng, p) {
  return rng() < p;
}
