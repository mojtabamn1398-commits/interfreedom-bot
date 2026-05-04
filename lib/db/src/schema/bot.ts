import {
  pgTable,
  serial,
  bigint,
  text,
  boolean,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

export const botUsersTable = pgTable("bot_users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name").notNull(),
  coins: integer("coins").notNull().default(0),
  isBlocked: boolean("is_blocked").notNull().default(false),
  referredBy: bigint("referred_by", { mode: "number" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const botServicesTable = pgTable("bot_services", {
  id: serial("id").primaryKey(),
  userTelegramId: bigint("user_telegram_id", { mode: "number" }).notNull(),
  name: text("name").notNull(),
  config: text("config").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
});

export const botServicePoolTable = pgTable("bot_service_pool", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  config: text("config").notNull(),
  isUsed: boolean("is_used").notNull().default(false),
  usedBy: bigint("used_by", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const botAdminsTable = pgTable("bot_admins", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  level: integer("level").notNull().default(1),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

export const botSettingsTable = pgTable("bot_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
