import { createHash } from "crypto";

export function calculateCrashPoint(serverSeed: string, nonce: number, honeypot = false): number {
  const hash = createHash("sha256").update(`crash:${serverSeed}:${nonce}`).digest("hex");
  const h = parseInt(hash.slice(0, 8), 16) / 0xffffffff; // 0 to 1
  const edge = honeypot ? 0.01 : 0.04; // 4% instant-crash house edge (1% for honeypot)
  if (h < edge) return 1.00;
  const raw = (1 - edge) / (1 - h);
  return Math.min(1000, Math.floor(raw * 100) / 100);
}

// Multiplier at t seconds: doubles ~every 10s
export function getMultiplierAt(elapsed: number): number {
  return Math.floor(Math.exp(0.07 * elapsed) * 100) / 100;
}

export function formatMultiplier(m: number): string {
  if (m >= 100) return m.toFixed(0) + "x";
  if (m >= 10) return m.toFixed(1) + "x";
  return m.toFixed(2) + "x";
}

export function multiplierColor(m: number): number {
  if (m < 1.5) return 0x00ff88;
  if (m < 2.5) return 0x88ff00;
  if (m < 5)   return 0xffcc00;
  if (m < 10)  return 0xff8800;
  return 0xff2200;
}

export function rocketBar(m: number, crashPoint: number): string {
  const pct = Math.min(1, (m - 1) / Math.max(1, crashPoint - 1));
  const filled = Math.floor(pct * 20);
  return "🟩".repeat(filled) + "⬜".repeat(20 - filled);
}
