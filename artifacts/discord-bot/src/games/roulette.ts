export type RouletteBet = "red" | "black" | "green" | "odd" | "even" | "low" | "high" | number;

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const BLACK_NUMBERS = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);

export function parseRouletteBet(input: string): RouletteBet | null {
  const lower = input.toLowerCase();
  if (["red","black","green","odd","even","low","high"].includes(lower)) return lower as RouletteBet;
  const n = parseInt(input);
  if (!isNaN(n) && n >= 0 && n <= 36) return n;
  return null;
}

export interface RouletteResult {
  number: number;
  color: "red" | "black" | "green";
  won: boolean;
  multiplier: number;
}

function biasedRouletteNumber(bet: RouletteBet, roll: number): number {
  if (typeof bet === "number") return Math.floor(roll * 37);
  if (bet === "green") return Math.floor(roll * 37);

  const winNums = bet === "red"  ? [...RED_NUMBERS] :
                  bet === "black" ? [...BLACK_NUMBERS] :
                  bet === "odd"  ? [1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35] :
                  bet === "even" ? [2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36] :
                  bet === "low"  ? Array.from({length:18},(_,i)=>i+1) :
                                   Array.from({length:18},(_,i)=>i+19);
  const loseNums = Array.from({length:37},(_,i)=>i).filter(n => !winNums.includes(n));

  if (roll < 0.70) {
    return winNums[Math.floor((roll / 0.70) * winNums.length)];
  } else {
    return loseNums[Math.floor(((roll - 0.70) / 0.30) * loseNums.length)] ?? loseNums[0];
  }
}

export function playRoulette(bet: RouletteBet, roll: number, honeypot = false): RouletteResult {
  const number = honeypot
    ? biasedRouletteNumber(bet, roll)
    : Math.floor(roll * 37);

  const color: "red" | "black" | "green" =
    number === 0 ? "green" : RED_NUMBERS.has(number) ? "red" : "black";

  let won = false;
  let multiplier = 0;

  if (typeof bet === "number") { won = bet === number; multiplier = 35; }
  else if (bet === "red")   { won = color === "red";   multiplier = 2; }
  else if (bet === "black") { won = color === "black"; multiplier = 2; }
  else if (bet === "green") { won = color === "green"; multiplier = 14; }
  else if (bet === "odd")   { won = number !== 0 && number % 2 !== 0; multiplier = 2; }
  else if (bet === "even")  { won = number !== 0 && number % 2 === 0; multiplier = 2; }
  else if (bet === "low")   { won = number >= 1 && number <= 18; multiplier = 2; }
  else if (bet === "high")  { won = number >= 19 && number <= 36; multiplier = 2; }

  return { number, color, won, multiplier };
}

export function colorEmoji(color: "red" | "black" | "green"): string {
  return color === "red" ? "🔴" : color === "black" ? "⚫" : "🟢";
}
