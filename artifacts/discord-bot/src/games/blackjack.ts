export type Card = { suit: string; value: string; numericValue: number };

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function cardValue(v: string): number {
  if (v === "A") return 11;
  if (["J", "Q", "K"].includes(v)) return 10;
  return parseInt(v);
}

export function createDeck(rolls: number[]): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value, numericValue: cardValue(value) });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rolls[i % rolls.length] * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function handValue(hand: Card[]): number {
  let total = hand.reduce((s, c) => s + c.numericValue, 0);
  let aces = hand.filter(c => c.value === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export function formatCard(c: Card): string { return `${c.value}${c.suit}`; }
export function formatHand(hand: Card[]): string { return hand.map(formatCard).join(" "); }

export interface BlackjackGame {
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  bet: number;
  userId: string;
  isDemo: boolean;
  honeypot: boolean;
  finished: boolean;
  rolls: number[];
}

export const activeGames = new Map<string, BlackjackGame>();

export function dealGame(userId: string, bet: number, rolls: number[], isDemo: boolean, honeypot: boolean): BlackjackGame {
  const deck = createDeck(rolls);
  const game: BlackjackGame = {
    deck,
    playerHand: [deck.pop()!, deck.pop()!],
    dealerHand: [deck.pop()!, deck.pop()!],
    bet, userId, isDemo, honeypot, finished: false, rolls,
  };
  activeGames.set(userId, game);
  return game;
}

export function playerHit(game: BlackjackGame): Card {
  const card = game.deck.pop()!;
  game.playerHand.push(card);
  return card;
}

export type BlackjackOutcome = "player_bust" | "dealer_bust" | "player_win" | "dealer_win" | "push" | "blackjack";

export function dealerPlay(game: BlackjackGame): BlackjackOutcome {
  const playerTotal = handValue(game.playerHand);
  if (playerTotal > 21) return "player_bust";
  const standAt = (game.isDemo || game.honeypot) ? 18 : 17;
  while (handValue(game.dealerHand) < standAt) {
    game.dealerHand.push(game.deck.pop()!);
  }
  const dealerTotal = handValue(game.dealerHand);
  if (playerTotal === 21 && game.playerHand.length === 2) return "blackjack";
  if (dealerTotal > 21) return "dealer_bust";
  if (playerTotal > dealerTotal) return "player_win";
  if (dealerTotal > playerTotal) return "dealer_win";
  return "push";
}
