const SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"];
const REAL_WEIGHTS  = [30, 25, 20, 15,  6,  3,  1];
const DEMO_WEIGHTS  = [20, 18, 17, 15, 12, 10,  8];
const HONEY_WEIGHTS = [15, 15, 15, 15, 15, 15, 10];

function weightedPick(weights: number[], roll: number): string {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = roll * total;
  for (let i = 0; i < SYMBOLS.length; i++) {
    r -= weights[i];
    if (r <= 0) return SYMBOLS[i];
  }
  return SYMBOLS[0];
}

export interface SlotsResult {
  reels: [string, string, string];
  multiplier: number;
  won: boolean;
}

export function playSlots(rolls: number[], demo: boolean, honeypot: boolean): SlotsResult {
  const weights = honeypot ? HONEY_WEIGHTS : demo ? DEMO_WEIGHTS : REAL_WEIGHTS;

  let reels: [string, string, string];
  if (honeypot && Math.random() < 0.50) {
    const sym = weightedPick(weights, rolls[0]);
    reels = [sym, sym, sym];
  } else {
    reels = [
      weightedPick(weights, rolls[0]),
      weightedPick(weights, rolls[1]),
      weightedPick(weights, rolls[2]),
    ];
  }

  const [a, b, c] = reels;
  if (a === b && b === c) {
    const idx = SYMBOLS.indexOf(a);
    const multipliers = [2, 2.5, 3, 4, 6, 10, 50];
    return { reels, multiplier: multipliers[idx] ?? 2, won: true };
  }
  if (a === b || b === c || a === c) {
    return { reels, multiplier: 1.5, won: true };
  }
  return { reels, multiplier: 0, won: false };
}
