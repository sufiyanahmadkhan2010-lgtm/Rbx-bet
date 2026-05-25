import { pgTable, text, bigint, integer, boolean, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const gameRecordsTable = pgTable("discord_game_records", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  gameType: text("game_type").notNull(),
  serverSeed: text("server_seed").notNull(),
  serverSeedHash: text("server_seed_hash").notNull(),
  clientSeed: text("client_seed").notNull(),
  nonce: integer("nonce").notNull(),
  fairHash: text("fair_hash").notNull(),
  resultData: text("result_data").notNull(),
  bet: bigint("bet", { mode: "number" }).notNull(),
  payout: bigint("payout", { mode: "number" }).notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGameRecordSchema = createInsertSchema(gameRecordsTable).omit({ id: true, createdAt: true });
export type InsertGameRecord = z.infer<typeof insertGameRecordSchema>;
export type GameRecord = typeof gameRecordsTable.$inferSelect;
