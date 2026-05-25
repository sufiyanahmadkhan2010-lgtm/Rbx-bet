import { createHash } from "crypto";

export const GRID_SIZE = 20; // 4 rows x 5 cols

export interface MinesGame {
  userId: string;
  bet: number;
  mines: number;
  minePositions: Set<number>;
  revealed: Set<number>;
  isDemo: boolean;
  cashoutMultiplier: number;
  active: boolean;
}

export const activeGames = new Map<string, MinesGame>();

export function generateMinePositions(serverSeed: string, nonce: number, mines: number): Set<number> {
  const positions = new Set<number>();
  let i = 0;
  while (positions.size < mines) {
    const hash = createHash("sha256").update(`mines:${serverSeed}:${nonce}:${i++}`).digest("hex");
    const pos = parseInt(hash.slice(0, 4), 16) % GRID_SIZE;
    positions.add(pos);
  }
  return positions;
}

// Probability of k safe reveals with m mines in n tiles
export function safeRevealProb(n: number, m: number, k: number): number {
  let prob = 1;
  for (let i = 0; i < k; i++) {
    prob *= (n - m - i) / (n - i);
  }
  return prob;
}

export function calculateMultiplier(n: number, m: number, k: number): number {
  if (k === 0) return 1.0;
  const prob = safeRevealProb(n, m, k);
  return Math.floor((0.96 / prob) * 100) / 100;
}

export function nextMultiplier(n: number, m: number, k: number): number {
  return calculateMultiplier(n, m, k + 1);
}
