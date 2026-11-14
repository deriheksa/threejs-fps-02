// A small seeded random source, so a capture run (?shot=...&seed=N) plays out the same
// way every time. mulberry32 is a compact, well-spread generator: the state is one 32-bit
// word, and each call advances it through a fixed mix.
export function makeRng(seed) {
  let word = seed | 0;
  return function next() {
    word = (word + 0x6d2b79f5) | 0;
    let mixed = Math.imul(word ^ (word >>> 15), 1 | word);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Spread a short string into a seed word, for naming a run from a word instead of a number.
export function seedFromText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}
