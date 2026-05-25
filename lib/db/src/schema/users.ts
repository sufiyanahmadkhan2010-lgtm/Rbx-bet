import { pgTable, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("discord_users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  demoBalance: bigint("demo_balance", { mode: "number" }).notNull().default(0),
  lastDemo: timestamp("last_demo", { withTimezone: true }),
  totalWon: bigint("total_won", { mode: "number" }).notNull().default(0),
  totalLost: bigint("total_lost", { mode: "number" }).notNull().default(0),
  demoTotalWon: bigint("demo_total_won", { mode: "number" }).notNull().default(0),
  demoTotalLost: bigint("demo_total_lost", { mode: "number" }).notNull().default(0),
  nonce: integer("nonce").notNull().default(0),
  clientSeed: text("client_seed").notNull().default("default"),
  lastDaily: timestamp("last_daily", { withTimezone: true }),
  lastMessageReward: timestamp("last_message_reward", { withTimezone: true }),
  lastStatusBonus: timestamp("last_status_bonus", { withTimezone: true }),
  messageCount: integer("message_count").notNull().default(0),
  inviteCount: integer("invite_count").notNull().default(0),
  gameCount: integer("game_count").notNull().default(0),
  demoGamesUsed: integer("demo_games_used").notNull().default(0),
  affiliateCode: text("affiliate_code").unique(),
  affiliateOf: text("affiliate_of"),
  affiliateTotalEarned: bigint("affiliate_total_earned", { mode: "number" }).notNull().default(0),
  affiliateCount: integer("affiliate_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
