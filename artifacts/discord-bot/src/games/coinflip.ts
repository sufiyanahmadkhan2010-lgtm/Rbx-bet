export type CoinSide = "heads" | "tails";

export function playCoinflip(choice: CoinSide, roll: number, demo: boolean): { result: CoinSide; won: boolean } {
  const threshold = demo ? 0.55 : 0.5;
  const result: CoinSide = roll < threshold ? "heads" : "tails";
  return { result, won: result === choice };
}
