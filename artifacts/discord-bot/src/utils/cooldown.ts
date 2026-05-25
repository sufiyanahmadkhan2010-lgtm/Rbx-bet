const cooldowns = new Map<string, number>();

export function checkCooldown(key: string, ms: number): number {
  const last = cooldowns.get(key) ?? 0;
  const remaining = last + ms - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function setCooldown(key: string): void {
  cooldowns.set(key, Date.now());
}

export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
