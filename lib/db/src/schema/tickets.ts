import { pgTable, text, bigint, timestamp, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ticketsTable = pgTable("discord_tickets", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull(),
  userId: text("user_id").notNull().references(() => usersTable.id),
  username: text("username").notNull(),
  type: text("type").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  status: text("status").notNull().default("pending"),
  handledBy: text("handled_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
