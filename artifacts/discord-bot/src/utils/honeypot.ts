const HONEYPOT_GAMES = 10;
const HONEYPOT_WIN_RATE = 0.70;

export function isHoneypotActive(gameCount: number): boolean {
  return gameCount < HONEYPOT_GAMES;
}

export function honeypotRoll(roll: number, gameCount: number): number {
  if (!isHoneypotActive(gameCount)) return roll;
  if (roll < HONEYPOT_WIN_RATE) return roll * (0.48 / HONEYPOT_WIN_RATE);
  return 0.52 + (roll - HONEYPOT_WIN_RATE) * (0.48 / (1 - HONEYPOT_WIN_RATE));
}

export function honeypotRolls(rolls: number[], gameCount: number): number[] {
  if (!isHoneypotActive(gameCount)) return rolls;
  return rolls.map(r => honeypotRoll(r, gameCount));
}
