import { createHash, randomBytes } from "crypto";
import { db, usersTable, gameRecordsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export function generateServerSeed(): string {
  return randomBytes(32).toString("hex");
}

export function hashSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

export function computeFairHash(serverSeed: string, clientSeed: string, nonce: number): string {
  return createHash("sha256").update(`${serverSeed}:${clientSeed}:${nonce}`).digest("hex");
}

export function hashToFloat(hash: string): number {
  return parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

export function hashToFloats(hash: string, count: number): number[] {
  const floats: number[] = [];
  for (let i = 0; i < count; i++) {
    const slice = hash.slice(i * 8, i * 8 + 8);
    if (slice.length < 8) {
      const extended = createHash("sha256").update(`${hash}:${i}`).digest("hex");
      floats.push(parseInt(extended.slice(0, 8), 16) / 0xffffffff);
    } else {
      floats.push(parseInt(slice, 16) / 0xffffffff);
    }
  }
  return floats;
}

export interface FairContext {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  fairHash: string;
  roll: number;
  rolls: number[];
}

export async function getFairContext(userId: string): Promise<FairContext> {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw new Error("User not found");

  const serverSeed = generateServerSeed();
  const serverSeedHash = hashSeed(serverSeed);
  const clientSeed = user.clientSeed;
  const nonce = user.nonce;
  const fairHash = computeFairHash(serverSeed, clientSeed, nonce);
  const rolls = hashToFloats(fairHash, 8);

  await db.update(usersTable)
    .set({ nonce: sql`${usersTable.nonce} + 1` })
    .where(eq(usersTable.id, userId));

  return { serverSeed, serverSeedHash, clientSeed, nonce, fairHash, roll: rolls[0], rolls };
}

export async function saveGameRecord(params: {
  userId: string;
  gameType: string;
  fair: FairContext;
  bet: number;
  payout: number;
  resultData: object;
  isDemo: boolean;
}): Promise<number> {
  const [record] = await db.insert(gameRecordsTable).values({
    userId: params.userId,
    gameType: params.gameType,
    serverSeed: params.fair.serverSeed,
    serverSeedHash: params.fair.serverSeedHash,
    clientSeed: params.fair.clientSeed,
    nonce: params.fair.nonce,
    fairHash: params.fair.fairHash,
    resultData: JSON.stringify(params.resultData),
    bet: params.bet,
    payout: params.payout,
    isDemo: params.isDemo,
  }).returning({ id: gameRecordsTable.id });
  return record.id;
}
