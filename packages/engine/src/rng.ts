export interface Rng {
  nextU32(): number;
  float01(): number;
}

// Deterministic, fast RNG for battle simulations (seeded).
export function makeRng(seed: number): Rng {
  let x = seed >>> 0;
  if (x === 0) x = 0x6d2b79f5; // avoid the all-zero state

  return {
    nextU32() {
      // xorshift32
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x >>>= 0;
      x ^= x << 5;
      x >>>= 0;
      return x;
    },
    float01() {
      // [0, 1)
      return (this.nextU32() >>> 0) / 4294967296;
    }
  };
}

