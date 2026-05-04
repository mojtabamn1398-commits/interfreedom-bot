import { db } from "@workspace/db";
import {
  botUsersTable,
  botServicesTable,
  botServicePoolTable,
  botAdminsTable,
  botSettingsTable,
} from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";

const SUPER_ADMIN_USERNAME = "Mojeao";

export async function getOrCreateUser(
  telegramId: number,
  username: string | undefined,
  firstName: string,
  referredBy?: number
): Promise<{ user: typeof botUsersTable.$inferSelect; isNew: boolean }> {
  const existing = await db
    .select()
    .from(botUsersTable)
    .where(eq(botUsersTable.telegramId, telegramId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(botUsersTable)
      .set({ username: username ?? null, firstName })
      .where(eq(botUsersTable.telegramId, telegramId));
    return { user: existing[0], isNew: false };
  }

  const [user] = await db
    .insert(botUsersTable)
    .values({
      telegramId,
      username: username ?? null,
      firstName,
      referredBy: referredBy && referredBy !== telegramId ? referredBy : null,
      coins: 0,
    })
    .returning();

  return { user: user!, isNew: true };
}

export async function grantReferralReward(telegramId: number): Promise<boolean> {
  const [user] = await db
    .select()
    .from(botUsersTable)
    .where(eq(botUsersTable.telegramId, telegramId))
    .limit(1);

  if (!user || !user.referredBy || user.referralRewarded) return false;

  const rewardStr = await getSetting("invite_reward");
  const reward = parseInt(rewardStr ?? "1", 10);

  await db
    .update(botUsersTable)
    .set({ coins: sql`${botUsersTable.coins} + ${reward}` })
    .where(eq(botUsersTable.telegramId, user.referredBy));

  await db
    .update(botUsersTable)
    .set({ referralRewarded: true })
    .where(eq(botUsersTable.telegramId, telegramId));

  return true;
}

export async function getReferrerInfo(referrerId: number) {
  const user = await getUserByTelegramId(referrerId);
  if (!user) return null;
  const invites = await getInviteCount(referrerId);
  return { user, invites };
}

export async function getUserByTelegramId(telegramId: number) {
  const [user] = await db
    .select()
    .from(botUsersTable)
    .where(eq(botUsersTable.telegramId, telegramId))
    .limit(1);
  return user ?? null;
}

export async function getUserByUsername(username: string) {
  const clean = username.replace("@", "").toLowerCase();
  const users = await db.select().from(botUsersTable);
  return users.find((u) => u.username?.toLowerCase() === clean) ?? null;
}

export async function getInviteCount(telegramId: number): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(botUsersTable)
    .where(eq(botUsersTable.referredBy, telegramId));
  return Number(result[0]?.count ?? 0);
}

export async function addCoins(telegramId: number, amount: number) {
  await db
    .update(botUsersTable)
    .set({ coins: sql`${botUsersTable.coins} + ${amount}` })
    .where(eq(botUsersTable.telegramId, telegramId));
}

export async function removeCoins(telegramId: number, amount: number) {
  await db
    .update(botUsersTable)
    .set({ coins: sql`GREATEST(0, ${botUsersTable.coins} - ${amount})` })
    .where(eq(botUsersTable.telegramId, telegramId));
}

export async function setCoins(telegramId: number, amount: number) {
  await db
    .update(botUsersTable)
    .set({ coins: amount })
    .where(eq(botUsersTable.telegramId, telegramId));
}

export async function addCoinsToAll(amount: number) {
  await db
    .update(botUsersTable)
    .set({ coins: sql`${botUsersTable.coins} + ${amount}` });
}

export async function blockUser(telegramId: number) {
  await db
    .update(botUsersTable)
    .set({ isBlocked: true })
    .where(eq(botUsersTable.telegramId, telegramId));
}

export async function unblockUser(telegramId: number) {
  await db
    .update(botUsersTable)
    .set({ isBlocked: false })
    .where(eq(botUsersTable.telegramId, telegramId));
}

export async function getBlockedUsers() {
  return db
    .select()
    .from(botUsersTable)
    .where(eq(botUsersTable.isBlocked, true));
}

export async function getAllUsers() {
  return db
    .select()
    .from(botUsersTable)
    .where(eq(botUsersTable.isBlocked, false));
}

export async function getRecentUsers(limit = 20) {
  return db
    .select()
    .from(botUsersTable)
    .orderBy(desc(botUsersTable.joinedAt))
    .limit(limit);
}

export async function getTopInviters(limit = 10) {
  const users = await db.select().from(botUsersTable);
  const counts: Record<number, { user: typeof botUsersTable.$inferSelect; count: number }> = {};
  for (const u of users) {
    if (u.referredBy) {
      if (!counts[u.referredBy]) {
        const inviter = users.find((x) => x.telegramId === u.referredBy);
        if (inviter) counts[u.referredBy] = { user: inviter, count: 0 };
      }
      if (counts[u.referredBy]) counts[u.referredBy]!.count++;
    }
  }
  return Object.values(counts)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getStats() {
  const [userCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botUsersTable);
  const [serviceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botServicesTable)
    .where(eq(botServicesTable.isActive, true));
  const [coinSum] = await db
    .select({ total: sql<number>`coalesce(sum(coins), 0)` })
    .from(botUsersTable);
  return {
    users: Number(userCount?.count ?? 0),
    services: Number(serviceCount?.count ?? 0),
    coins: Number(coinSum?.total ?? 0),
  };
}

export async function getUserServices(telegramId: number) {
  return db
    .select()
    .from(botServicesTable)
    .where(
      and(
        eq(botServicesTable.userTelegramId, telegramId),
        eq(botServicesTable.isActive, true)
      )
    )
    .orderBy(desc(botServicesTable.createdAt));
}

export async function deleteUserServices(telegramId: number) {
  await db
    .update(botServicesTable)
    .set({ isActive: false })
    .where(eq(botServicesTable.userTelegramId, telegramId));
}

export async function getServiceFromPool() {
  const [item] = await db
    .select()
    .from(botServicePoolTable)
    .where(eq(botServicePoolTable.isUsed, false))
    .limit(1);
  return item ?? null;
}

export async function assignServiceToUser(poolId: number, telegramId: number) {
  const [poolItem] = await db
    .select()
    .from(botServicePoolTable)
    .where(eq(botServicePoolTable.id, poolId))
    .limit(1);
  if (!poolItem) return null;

  await db
    .update(botServicePoolTable)
    .set({ isUsed: true, usedBy: telegramId })
    .where(eq(botServicePoolTable.id, poolId));

  const [service] = await db
    .insert(botServicesTable)
    .values({
      userTelegramId: telegramId,
      name: poolItem.name,
      config: poolItem.config,
    })
    .returning();
  return service ?? null;
}

export async function createDirectService(telegramId: number, name: string, config: string) {
  const [service] = await db
    .insert(botServicesTable)
    .values({ userTelegramId: telegramId, name, config })
    .returning();
  return service!;
}

export async function addServiceToPool(name: string, config: string) {
  const [item] = await db
    .insert(botServicePoolTable)
    .values({ name, config })
    .returning();
  return item!;
}

export async function getPoolStats() {
  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botServicePoolTable);
  const [available] = await db
    .select({ count: sql<number>`count(*)` })
    .from(botServicePoolTable)
    .where(eq(botServicePoolTable.isUsed, false));
  return {
    total: Number(total?.count ?? 0),
    available: Number(available?.count ?? 0),
  };
}

export async function isAdmin(telegramId: number, username?: string) {
  if (username === SUPER_ADMIN_USERNAME) return true;
  const [admin] = await db
    .select()
    .from(botAdminsTable)
    .where(eq(botAdminsTable.telegramId, telegramId))
    .limit(1);
  return !!admin;
}

export async function isSuperAdmin(telegramId: number, username?: string) {
  if (username === SUPER_ADMIN_USERNAME) return true;
  const [admin] = await db
    .select()
    .from(botAdminsTable)
    .where(eq(botAdminsTable.telegramId, telegramId))
    .limit(1);
  return admin?.level === 2;
}

export async function ensureSuperAdmin(telegramId: number, username?: string) {
  if (username !== SUPER_ADMIN_USERNAME) return;
  const [existing] = await db
    .select()
    .from(botAdminsTable)
    .where(eq(botAdminsTable.telegramId, telegramId))
    .limit(1);
  if (!existing) {
    await db.insert(botAdminsTable).values({
      telegramId,
      username: username ?? null,
      level: 2,
    });
  } else if (existing.level !== 2) {
    await db
      .update(botAdminsTable)
      .set({ level: 2 })
      .where(eq(botAdminsTable.telegramId, telegramId));
  }
}

export async function addAdmin(
  telegramId: number,
  username: string | undefined,
  level = 1
) {
  await db
    .insert(botAdminsTable)
    .values({ telegramId, username: username ?? null, level })
    .onConflictDoUpdate({
      target: botAdminsTable.telegramId,
      set: { username: username ?? null, level },
    });
}

export async function removeAdmin(telegramId: number) {
  await db
    .delete(botAdminsTable)
    .where(eq(botAdminsTable.telegramId, telegramId));
}

export async function getAdmins() {
  return db.select().from(botAdminsTable).orderBy(desc(botAdminsTable.level));
}

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(botSettingsTable)
    .where(eq(botSettingsTable.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await db
    .insert(botSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: botSettingsTable.key,
      set: { value },
    });
}

export async function getDefaultSettings() {
  const defaults: Record<string, string> = {
    welcome_message: "به ربات خوش اومدی!\nاز منوی پایین یکی از گزینه‌ها رو انتخاب کن.",
    support_username: "@Abslnf",
    channel_username: "@lnterFreedom",
    mandatory_channel: "@lnterFreedom",
    invite_reward: "1",
    maintenance_mode: "false",
    service_cost: "4",
    base_vless_config: "vless://80dafdc7-38fa-4cf6-8b05-83e52c97d876@185.143.234.235:80?security=&encryption=none&host=vixon.portab.org&type=ws",
  };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = await getSetting(key);
    if (!existing) await setSetting(key, value);
  }
}
