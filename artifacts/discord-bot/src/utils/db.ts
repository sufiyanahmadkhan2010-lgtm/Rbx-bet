import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { User } from "@workspace/db";

function generateAffiliateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function ensureUniqueAffiliateCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateAffiliateCode();
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.affiliateCode, code)).limit(1);
    if (existing.length === 0) return code;
  }
  return generateAffiliateCode() + Date.now().toString(36).slice(-2).toUpperCase();
}

export async function getOrCreateUser(userId: string, username: string): Promise<User> {
  const existing = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (existing.length > 0) {
    if (existing[0].username !== username) {
      await db.update(usersTable).set({ username }).where(eq(usersTable.id, userId));
      return { ...existing[0], username };
    }
    return existing[0];
  }
  const affiliateCode = await ensureUniqueAffiliateCode();
  const [user] = await db.insert(usersTable).values({
    id: userId,
    username,
    balance: 0,
    demoBalance: 0,
    clientSeed: `${userId}-${Date.now()}`,
    affiliateCode,
  }).returning();
  return user;
}

export async function getUser(userId: string): Promise<User | null> {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function updateBalance(
  userId: string,
  amount: number,
  type: string,
  description: string,
  isDemo = false,
): Promise<User> {
  const user = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user[0]) throw new Error("User not found");

  const balanceBefore = isDemo ? user[0].demoBalance : user[0].balance;
  const balanceAfter = balanceBefore + amount;
  const wonDelta = amount > 0 ? amount : 0;
  const lostDelta = amount < 0 ? Math.abs(amount) : 0;

  const updateData: Record<string, unknown> = {
    [isDemo ? "demoBalance" : "balance"]: balanceAfter,
    [isDemo ? "demoTotalWon" : "totalWon"]: sql`${isDemo ? usersTable.demoTotalWon : usersTable.totalWon} + ${wonDelta}`,
    [isDemo ? "demoTotalLost" : "totalLost"]: sql`${isDemo ? usersTable.demoTotalLost : usersTable.totalLost} + ${lostDelta}`,
  };

  const [updated] = await db.update(usersTable).set(updateData as any).where(eq(usersTable.id, userId)).returning();
  await db.insert(transactionsTable).values({
    userId,
    type: isDemo ? `demo_${type}` : type,
    amount,
    balanceBefore,
    balanceAfter,
    description: isDemo ? `[DEMO] ${description}` : description,
  });
  return updated;
}

export async function applyAffiliateBonus(userId: string, winAmount: number): Promise<void> {
  if (winAmount <= 0) return;
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const user = rows[0];
  if (!user?.affiliateOf) return;

  const bonus = Math.floor(winAmount * 0.10);
  if (bonus <= 0) return;

  const ref = await db.select().from(usersTable).where(eq(usersTable.id, user.affiliateOf)).limit(1);
  if (!ref[0]) return;

  const newBal = ref[0].balance + bonus;
  await db.update(usersTable).set({
    balance: newBal,
    affiliateTotalEarned: sql`${usersTable.affiliateTotalEarned} + ${bonus}`,
  }).where(eq(usersTable.id, user.affiliateOf));

  await db.insert(transactionsTable).values({
    userId: user.affiliateOf,
    type: "affiliate_bonus",
    amount: bonus,
    balanceBefore: ref[0].balance,
    balanceAfter: newBal,
    description: `10% affiliate bonus from ${user.username}'s win of ${winAmount}`,
  });
}

export async function getLeaderboard(isDemo = false): Promise<User[]> {
  const col = isDemo ? usersTable.demoBalance : usersTable.balance;
  return db.select().from(usersTable).orderBy(col).limit(10).then(rows => rows.reverse());
}
