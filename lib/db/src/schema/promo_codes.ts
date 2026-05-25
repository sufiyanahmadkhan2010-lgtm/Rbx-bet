import { pgTable, text, bigint, integer, boolean, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const promoCodesTable = pgTable("discord_promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  usesLeft: integer("uses_left").notNull(),
  createdBy: text("created_by").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promoClaimsTable = pgTable("discord_promo_claims", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  code: text("code").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPromoCodeSchema = createInsertSchema(promoCodesTable).omit({ id: true, createdAt: true });
export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoCode = typeof promoCodesTable.$inferSelect;
