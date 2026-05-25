import { Message, EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getOrCreateUser, updateBalance, getLeaderboard } from "../utils/db";
import { baseEmbed, winEmbed, loseEmbed, errorEmbed, formatRobux, BOT_COLOR } from "../utils/embed";
import { playCoinflip } from "../games/coinflip";
import { playSlots } from "../games/slots";
import { playRoulette, parseRouletteBet, colorEmoji } from "../games/roulette";
import { getFairContext, saveGameRecord } from "../utils/provably-fair";
import { isHoneypotActive, honeypotRoll, honeypotRolls } from "../utils/honeypot";
import { incrementCounts } from "../utils/gameUtils";
import { checkOwnerMessage } from "../utils/admin";
import { roleStrikeWatches } from "../commands/rolestrike";
import { autoResponders } from "../commands/autoresponder";
import { db, usersTable, ticketsTable, promoCodesTable, promoClaimsTable, gameRecordsTable, transactionsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { hashSeed, computeFairHash } from "../utils/provably-fair";
import { watchedMessages } from "../commands/autoban";

const PREFIX = ".";
const HOUSE_EDGE = 0.96;

function parseBet(str: string): number | null {
  const n = parseInt(str);
  return isNaN(n) || n < 1 ? null : n;
}

function parseMention(str: string): string | null {
  const match = str?.match(/^<@!?(\d+)>$/);
  return match ? match[1] : (/^\d+$/.test(str ?? "") ? str : null);
}

async function replyEmbed(msg: Message, embed: EmbedBuilder) {
  await msg.reply({ embeds: [embed] }).catch(() => {});
}

export async function handlePrefixMessage(message: Message) {
  try {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const raw = message.content.slice(PREFIX.length).trim();
    const parts = raw.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    // ── PING ──────────────────────────────────────────────────────────────────
    if (cmd === "ping") {
      const sent = await message.reply({ content: "Pinging…" });
      const latency = sent.createdTimestamp - message.createdTimestamp;
      const wsPing = Math.round(message.client.ws.ping);
      await sent.edit({ content: "", embeds: [baseEmbed("✅ Pong!")
        .setDescription(`• **Bot Latency:** \`${latency}ms\`\n• **WebSocket:** \`${wsPing}ms\`\n• **Uptime:** \`${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m\``)] });
      return;
    }

    // ── HELP ──────────────────────────────────────────────────────────────────
    if (cmd === "help") {
      const isOwner = await checkOwnerMessage(message);
      const embed = new EmbedBuilder()
        .setTitle("📋 Command List")
        .setColor(BOT_COLOR)
        .setDescription("All commands work with `.` prefix. Interactive games (blackjack, crash, mines) also available as `/` slash commands.")
        .addFields(
          {
            name: "💰 Economy",
            value: [
              "`.bal` — Check your balance",
              "`.daily` — Claim 1,000 free Robux (24h)",
              "`.demo` — Claim 1,000 Demo Robux (24h)",
              "`.give @user <amount>` — Send Robux to someone",
              "`.deposit <amount>` — Request a deposit (min 50)",
              "`.withdraw <amount>` — Request a withdrawal",
            ].join("\n"),
          },
          {
            name: "🎮 Games",
            value: [
              "`.cf <bet> <heads/tails>` — Coinflip",
              "`.slots <bet>` — Slot machine",
              "`.rl <bet> <red/black/0-36/...>` — Roulette",
              "`.bj <bet>` — Blackjack *(use `/blackjack`)*",
              "`.crash <bet>` — Crash *(use `/crash`)*",
              "`.mines <bet> <mines>` — Mines *(use `/mines`)*",
            ].join("\n"),
          },
          {
            name: "📊 Stats & Tools",
            value: [
              "`.stats` — View your gambling stats",
              "`.lb` — Top 10 leaderboard",
              "`.verify <game_id>` — Verify provably fair result",
              "`.setseed <seed>` — Set your client seed",
              "`.ping` — Check bot latency",
            ].join("\n"),
          },
          {
            name: "🎁 Bonuses",
            value: [
              "`.promo <code>` — Redeem a promo code",
              "`.affiliate` — View your affiliate info & code",
              "`.affiliate <code>` — Link a referrer",
              "`.statusbonus` — Claim daily status bonus",
            ].join("\n"),
          },
          ...(isOwner ? [{
            name: "🔒 Admin (Owner Only)",
            value: [
              "`.admin setbalance @user <amount>`",
              "`.admin addbalance @user <amount> [reason]`",
              "`.admin setdemo @user <amount>`",
              "`.admin resetbalance @user`",
              "`.admin lookup @user`",
              "`.admin txhistory @user [limit]`",
              "`.promo create <code> <amount> <uses>`",
              "`.promo delete <code>` / `.promo list`",
              "`.bc #channel Message` / `.bc #channel Title | Message`",
              "`.ar add <trigger> | <response> [| exact|contains|startswith]`",
              "`.ar remove <trigger>` / `.ar list` / `.ar clear`",
              "`.rolestrike watch <msg_id> <role_id> [chan_id] [label]`",
              "`.rolestrike unwatch <msg_id>` / `.rolestrike list`",
              "`.autoban watch <msg_id> [chan_id] [label]`",
              "`.autoban unwatch <msg_id>` / `.autoban list`",
              "`.banreacters <msg_id> [chan_id]`",
            ].join("\n"),
          }] : []),
        )
        .setFooter({ text: "Slash commands (/balance, /coinflip, etc.) also work for everything." })
        .setTimestamp();

      await message.reply({ embeds: [embed] }).catch(() => {});
      return;
    }

    // Load user (most commands need it)
    const needsUser = !["help", "ping", "promo", "autoban", "banreacters"].includes(cmd ?? "");
    let user = needsUser ? await getOrCreateUser(message.author.id, message.author.username).catch(() => null) : null;
    if (needsUser && !user) {
      await message.reply({ content: "❌ Could not load your profile. Try again in a moment." }).catch(() => {});
      return;
    }

    // ── BALANCE ───────────────────────────────────────────────────────────────
    if (cmd === "balance" || cmd === "bal") {
      await replyEmbed(message, baseEmbed(`💰 ${message.author.username}'s Balance`)
        .addFields(
          { name: "💰 Real Robux", value: formatRobux(user!.balance), inline: true },
          { name: "🎮 Demo Robux", value: formatRobux(user!.demoBalance), inline: true },
        ));

    // ── DAILY ─────────────────────────────────────────────────────────────────
    } else if (cmd === "daily") {
      const DAILY_AMOUNT = 1000;
      const DAILY_MS = 24 * 60 * 60 * 1000;
      if (user!.lastDaily && Date.now() - user!.lastDaily.getTime() < DAILY_MS) {
        const rem = DAILY_MS - (Date.now() - user!.lastDaily.getTime());
        const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000), s = Math.floor((rem % 60000) / 1000);
        await replyEmbed(message, errorEmbed(`Already claimed! Come back in **${h}h ${m}m ${s}s**.`));
        return;
      }
      await db.update(usersTable).set({ lastDaily: new Date() }).where(eq(usersTable.id, user!.id));
      const updated = await updateBalance(user!.id, DAILY_AMOUNT, "daily", "Daily claim");
      await replyEmbed(message, winEmbed("📅 Daily Claimed!", `You got ${formatRobux(DAILY_AMOUNT)}!\nBalance: ${formatRobux(updated.balance)}`));

    // ── DEMO ──────────────────────────────────────────────────────────────────
    } else if (cmd === "demo") {
      const DEMO_AMOUNT = 1000;
      const DEMO_MS = 24 * 60 * 60 * 1000;
      if (user!.lastDemo && Date.now() - user!.lastDemo.getTime() < DEMO_MS) {
        const rem = DEMO_MS - (Date.now() - user!.lastDemo.getTime());
        const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000), s = Math.floor((rem % 60000) / 1000);
        await replyEmbed(message, errorEmbed(`Already claimed! Come back in **${h}h ${m}m ${s}s**.\nDemo balance: ${formatRobux(user!.demoBalance)}`));
        return;
      }
      await db.update(usersTable).set({ lastDemo: new Date() }).where(eq(usersTable.id, user!.id));
      const updated = await updateBalance(user!.id, DEMO_AMOUNT, "demo_claim", "Demo cash claim", true);
      await replyEmbed(message, winEmbed("🎮 Demo Cash Claimed!", `You received ${formatRobux(DEMO_AMOUNT)} Demo Robux!\nDemo balance: ${formatRobux(updated.demoBalance)}`));

    // ── STATS ─────────────────────────────────────────────────────────────────
    } else if (cmd === "stats") {
      const net = user!.totalWon - user!.totalLost;
      await replyEmbed(message, baseEmbed(`📊 ${message.author.username}'s Stats`)
        .addFields(
          { name: "Balance", value: formatRobux(user!.balance), inline: true },
          { name: "Won", value: formatRobux(user!.totalWon), inline: true },
          { name: "Lost", value: formatRobux(user!.totalLost), inline: true },
          { name: "Net", value: `${net >= 0 ? "+" : ""}${formatRobux(Math.abs(net))}`, inline: true },
          { name: "Invites", value: `${user!.inviteCount}`, inline: true },
          { name: "Messages", value: `${user!.messageCount}`, inline: true },
        ));

    // ── GIVE ──────────────────────────────────────────────────────────────────
    } else if (cmd === "give") {
      const targetId = parseMention(args[0]);
      const amount = parseBet(args[1]);
      if (!targetId || !amount) {
        await replyEmbed(message, errorEmbed("Usage: `.give @user <amount>`"));
        return;
      }
      if (targetId === message.author.id) {
        await replyEmbed(message, errorEmbed("You can't give Robux to yourself!"));
        return;
      }
      if (user!.balance < amount) {
        await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user!.balance)}`));
        return;
      }
      const targetUser = await message.client.users.fetch(targetId).catch(() => null);
      if (!targetUser || targetUser.bot) {
        await replyEmbed(message, errorEmbed("User not found or is a bot."));
        return;
      }
      await getOrCreateUser(targetId, targetUser.username);
      await updateBalance(message.author.id, -amount, "give_sent", `Gave to ${targetUser.username}`);
      const updated = await updateBalance(targetId, amount, "give_received", `Received from ${message.author.username}`);
      await replyEmbed(message, winEmbed("Gift Sent! 🎁", `**${message.author.username}** gave ${formatRobux(amount)} to **${targetUser.username}**!\n${targetUser.username}'s new balance: ${formatRobux(updated.balance)}`));

    // ── DEPOSIT ───────────────────────────────────────────────────────────────
    } else if (cmd === "deposit") {
      if (!message.guild) { await replyEmbed(message, errorEmbed("Must be used in a server.")); return; }
      const amount = parseBet(args[0]);
      if (!amount || amount < 50) {
        await replyEmbed(message, errorEmbed("Usage: `.deposit <amount>` (minimum 50)"));
        return;
      }
      const channel = await message.guild.channels.create({
        name: `deposit-${message.author.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 100),
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: message.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: message.client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
        ],
      });
      const [ticket] = await db.insert(ticketsTable).values({
        channelId: channel.id,
        userId: message.author.id,
        username: message.author.username,
        type: "deposit",
        amount,
        status: "pending",
      }).returning();
      const embed = new EmbedBuilder().setTitle("💰 Deposit Request").setColor(BOT_COLOR)
        .setThumbnail(message.author.displayAvatarURL())
        .addFields(
          { name: "User", value: `<@${message.author.id}>`, inline: true },
          { name: "Amount", value: formatRobux(amount), inline: true },
          { name: "Status", value: "⏳ Pending", inline: true },
        )
        .setFooter({ text: `Ticket #${ticket.id} • Channel deletes automatically on approval/denial` })
        .setTimestamp();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ticket_approve_${ticket.id}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ticket_deny_${ticket.id}`).setLabel("❌ Deny").setStyle(ButtonStyle.Danger),
      );
      await channel.send({ content: `<@${message.author.id}> Your deposit ticket is open. An admin will review it shortly.`, embeds: [embed], components: [row] });
      await replyEmbed(message, baseEmbed("🎫 Ticket Created!").setDescription(`Deposit request for ${formatRobux(amount)} submitted.\nHead to ${channel} to track it.`));

    // ── WITHDRAW ──────────────────────────────────────────────────────────────
    } else if (cmd === "withdraw") {
      if (!message.guild) { await replyEmbed(message, errorEmbed("Must be used in a server.")); return; }
      const amount = parseBet(args[0]);
      if (!amount) {
        await replyEmbed(message, errorEmbed("Usage: `.withdraw <amount>`"));
        return;
      }
      if (user!.balance < amount) {
        await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user!.balance)}`));
        return;
      }
      const channel = await message.guild.channels.create({
        name: `withdraw-${message.author.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 100),
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: message.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: message.client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
        ],
      });
      const [ticket] = await db.insert(ticketsTable).values({
        channelId: channel.id,
        userId: message.author.id,
        username: message.author.username,
        type: "withdraw",
        amount,
        status: "pending",
      }).returning();
      const embed = new EmbedBuilder().setTitle("💸 Withdrawal Request").setColor(0xe74c3c)
        .setThumbnail(message.author.displayAvatarURL())
        .addFields(
          { name: "User", value: `<@${message.author.id}>`, inline: true },
          { name: "Amount", value: formatRobux(amount), inline: true },
          { name: "Balance After", value: formatRobux(user!.balance - amount), inline: true },
          { name: "Status", value: "⏳ Pending", inline: true },
        )
        .setFooter({ text: `Ticket #${ticket.id} • Channel deletes automatically on approval/denial` })
        .setTimestamp();
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`ticket_approve_${ticket.id}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ticket_deny_${ticket.id}`).setLabel("❌ Deny").setStyle(ButtonStyle.Danger),
      );
      await channel.send({ content: `<@${message.author.id}> Your withdrawal ticket is open. An admin will review it shortly.`, embeds: [embed], components: [row] });
      await replyEmbed(message, baseEmbed("🎫 Ticket Created!").setDescription(`Withdrawal request for ${formatRobux(amount)} submitted.\nHead to ${channel} to track it.`));

    // ── VERIFY ────────────────────────────────────────────────────────────────
    } else if (cmd === "verify") {
      const gameId = parseInt(args[0]);
      if (isNaN(gameId) || gameId < 1) {
        await replyEmbed(message, errorEmbed("Usage: `.verify <game_id>`"));
        return;
      }
      const rows = await db.select().from(gameRecordsTable).where(eq(gameRecordsTable.id, gameId)).limit(1);
      if (rows.length === 0) {
        await replyEmbed(message, errorEmbed(`No game found with ID **${gameId}**.`));
        return;
      }
      const record = rows[0];
      const recomputedHash = computeFairHash(record.serverSeed, record.clientSeed, record.nonce);
      const serverSeedHash = hashSeed(record.serverSeed);
      const verified = recomputedHash === record.fairHash && serverSeedHash === record.serverSeedHash;
      let result: Record<string, unknown> = {};
      try { result = JSON.parse(record.resultData); } catch {}
      const embed = baseEmbed(`🔍 Game #${gameId} — ${verified ? "✅ VERIFIED" : "❌ FAILED"}`, verified ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: "Type", value: record.gameType.toUpperCase(), inline: true },
          { name: "Bet", value: record.bet.toLocaleString(), inline: true },
          { name: "Payout", value: (record.payout >= 0 ? "+" : "") + record.payout.toLocaleString(), inline: true },
          { name: "Result", value: `\`${JSON.stringify(result)}\``, inline: false },
          { name: "Server Seed", value: `\`${record.serverSeed}\``, inline: false },
          { name: "Client Seed / Nonce", value: `\`${record.clientSeed}\` / \`${record.nonce}\``, inline: false },
        );
      await replyEmbed(message, embed);

    // ── SETSEED ───────────────────────────────────────────────────────────────
    } else if (cmd === "setseed") {
      const seed = args.join(" ").trim().slice(0, 64);
      if (!seed) {
        await replyEmbed(message, errorEmbed("Usage: `.setseed <your_seed>`"));
        return;
      }
      await db.update(usersTable).set({ clientSeed: seed }).where(eq(usersTable.id, user!.id));
      await replyEmbed(message, winEmbed("🔑 Client Seed Updated", `Your new seed: \`${seed}\`\nAll future games will use this seed.`));

    // ── STATUSBONUS ───────────────────────────────────────────────────────────
    } else if (cmd === "statusbonus") {
      if (!message.guild) { await replyEmbed(message, errorEmbed("Must be used in a server.")); return; }
      const REQUIRED_STATUS = "best robux casino discord.gg/v47te8Z6Yn";
      const BONUS_AMOUNT = 10;
      const COOLDOWN_MS = 24 * 60 * 60 * 1000;
      if (user!.lastStatusBonus && Date.now() - user!.lastStatusBonus.getTime() < COOLDOWN_MS) {
        const rem = COOLDOWN_MS - (Date.now() - user!.lastStatusBonus.getTime());
        const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
        await replyEmbed(message, errorEmbed(`Already claimed today! Come back in **${h}h ${m}m**.`));
        return;
      }
      const member = await message.guild.members.fetch({ user: message.author.id, force: true }).catch(() => null);
      const customStatus = member?.presence?.activities.find(a => a.type === 4);
      const hasStatus = (customStatus?.state ?? "").toLowerCase().includes(REQUIRED_STATUS.toLowerCase());
      if (!hasStatus) {
        await replyEmbed(message, baseEmbed("❌ Status Not Found")
          .setDescription(`Set this as your Discord custom status, then try again:\n\`\`\`${REQUIRED_STATUS}\`\`\``));
        return;
      }
      await db.update(usersTable).set({ lastStatusBonus: new Date() }).where(eq(usersTable.id, user!.id));
      const updated = await updateBalance(user!.id, BONUS_AMOUNT, "status_bonus", "Daily status bonus");
      await replyEmbed(message, winEmbed("📣 Status Bonus Claimed!", `You earned ${formatRobux(BONUS_AMOUNT)}!\nBalance: ${formatRobux(updated.balance)}`));

    // ── AFFILIATE ─────────────────────────────────────────────────────────────
    } else if (cmd === "affiliate") {
      const code = args[0]?.toUpperCase().trim();
      if (!code) {
        const lines = [
          `Your affiliate code: \`${user!.affiliateCode ?? "N/A"}\``,
          ``,
          `Share this code — when others use \`.affiliate <code>\`, you earn **10% of their winnings forever**.`,
          ``,
          `**Total Earned:** ${formatRobux(user!.affiliateTotalEarned)}`,
          `**Referrals:** ${user!.affiliateCount}`,
        ];
        if (user!.affiliateOf) {
          const ref = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, user!.affiliateOf)).limit(1);
          lines.push(`\n**Your Referrer:** ${ref[0]?.username ?? "Unknown"}`);
        }
        await replyEmbed(message, baseEmbed("🤝 Affiliate System").setDescription(lines.join("\n")));
      } else {
        if (user!.affiliateOf) {
          await replyEmbed(message, errorEmbed("You already have a referrer linked. This cannot be changed."));
          return;
        }
        if (code === user!.affiliateCode) {
          await replyEmbed(message, errorEmbed("You can't use your own affiliate code."));
          return;
        }
        const refs = await db.select().from(usersTable).where(eq(usersTable.affiliateCode, code)).limit(1);
        if (!refs[0]) {
          await replyEmbed(message, errorEmbed(`No user found with affiliate code **${code}**.`));
          return;
        }
        const referrer = refs[0];
        await db.update(usersTable).set({ affiliateOf: referrer.id }).where(eq(usersTable.id, user!.id));
        await db.update(usersTable).set({ affiliateCount: sql`${usersTable.affiliateCount} + 1` }).where(eq(usersTable.id, referrer.id));
        await replyEmbed(message, winEmbed("🤝 Affiliate Linked!", `You're now referred by **${referrer.username}**. They earn 10% of your winnings!`));
        try {
          const refUser = await message.client.users.fetch(referrer.id);
          await refUser.send(`🎉 **${message.author.username}** just claimed your affiliate code **${code}**!`);
        } catch {}
      }

    // ── PROMO ─────────────────────────────────────────────────────────────────
    } else if (cmd === "promo") {
      const sub = args[0]?.toLowerCase();

      if (sub === "create" || sub === "delete" || sub === "list") {
        if (!(await checkOwnerMessage(message))) {
          await replyEmbed(message, errorEmbed("Only the bot owner can manage promo codes."));
          return;
        }
        if (sub === "create") {
          const code = args[1]?.toUpperCase().trim();
          const amount = parseBet(args[2]);
          const uses = parseBet(args[3]);
          if (!code || !amount || !uses) {
            await replyEmbed(message, errorEmbed("Usage: `.promo create <code> <amount> <uses>`"));
            return;
          }
          const existing = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, code)).limit(1);
          if (existing.length > 0) {
            await replyEmbed(message, errorEmbed(`Code **${code}** already exists.`));
            return;
          }
          await db.insert(promoCodesTable).values({ code, amount, maxUses: uses, usesLeft: uses, createdBy: message.author.username });
          await replyEmbed(message, winEmbed("✅ Promo Created!", `Code: **${code}**\nAmount: ${formatRobux(amount)}\nUses: ${uses}`));
        } else if (sub === "delete") {
          const code = args[1]?.toUpperCase().trim();
          if (!code) { await replyEmbed(message, errorEmbed("Usage: `.promo delete <code>`")); return; }
          await db.update(promoCodesTable).set({ active: false }).where(eq(promoCodesTable.code, code));
          await replyEmbed(message, baseEmbed("🗑️ Promo Deactivated").setDescription(`Code **${code}** has been deactivated.`));
        } else {
          const codes = await db.select().from(promoCodesTable).orderBy(promoCodesTable.createdAt).limit(20);
          if (codes.length === 0) {
            await replyEmbed(message, baseEmbed("Promo Codes").setDescription("No promo codes yet."));
            return;
          }
          const lines = codes.map(c => `**${c.code}** — ${formatRobux(c.amount)} — ${c.usesLeft}/${c.maxUses} uses — ${c.active ? "✅" : "❌"}`);
          await replyEmbed(message, baseEmbed("🎟️ Promo Codes").setDescription(lines.join("\n")));
        }
        return;
      }

      // Claim a promo code
      const code = (sub ?? "").toUpperCase().trim();
      if (!code) { await replyEmbed(message, errorEmbed("Usage: `.promo <code>`")); return; }
      const promos = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, code)).limit(1);
      if (!promos[0] || !promos[0].active || promos[0].usesLeft <= 0) {
        await replyEmbed(message, errorEmbed(`Promo code **${code}** is invalid, expired, or out of uses.`));
        return;
      }
      const promo = promos[0];
      const alreadyClaimed = await db.select().from(promoClaimsTable)
        .where(and(eq(promoClaimsTable.userId, user!.id), eq(promoClaimsTable.code, code))).limit(1);
      if (alreadyClaimed.length > 0) {
        await replyEmbed(message, errorEmbed(`You've already claimed promo code **${code}**.`));
        return;
      }
      await db.update(promoCodesTable).set({ usesLeft: sql`${promoCodesTable.usesLeft} - 1` }).where(eq(promoCodesTable.code, code));
      await db.insert(promoClaimsTable).values({ userId: user!.id, code });
      const updated = await updateBalance(user!.id, promo.amount, "promo", `Promo code: ${code}`);
      await replyEmbed(message, winEmbed("🎁 Promo Claimed!", `You received ${formatRobux(promo.amount)} from code **${code}**!\nBalance: ${formatRobux(updated.balance)}`));

    // ── COINFLIP ──────────────────────────────────────────────────────────────
    } else if (cmd === "cf" || cmd === "coinflip") {
      const bet = parseBet(args[0]);
      const side = args[1]?.toLowerCase();
      if (!bet || !["heads", "tails"].includes(side ?? "")) {
        await replyEmbed(message, errorEmbed("Usage: `.cf <bet> <heads/tails>`"));
        return;
      }
      if (user!.balance < bet) { await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user!.balance)}`)); return; }

      const fair = await getFairContext(user!.id);
      const honeypot = isHoneypotActive(user!.gameCount);
      const roll = honeypot ? honeypotRoll(fair.roll, user!.gameCount) : fair.roll;
      const { result, won } = playCoinflip(side as any, roll, false);
      const payout = won ? Math.floor(bet * HOUSE_EDGE) : -bet;
      const updated = await updateBalance(user!.id, payout, "coinflip", `Coinflip ${won ? "win" : "loss"}`);
      await incrementCounts(user!.id, false);
      const gameId = await saveGameRecord({ userId: user!.id, gameType: "coinflip", fair, bet, payout, resultData: { side, result, won }, isDemo: false });
      const coinEmoji = result === "heads" ? "🪙" : "🌕";
      if (won) {
        await replyEmbed(message, winEmbed("Coinflip Win!", `${coinEmoji} **${result}**! Won ${formatRobux(Math.abs(payout))}!\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
      } else {
        await replyEmbed(message, loseEmbed("Coinflip Loss!", `${coinEmoji} **${result}**! Lost ${formatRobux(bet)}.\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
      }

    // ── SLOTS ─────────────────────────────────────────────────────────────────
    } else if (cmd === "slots") {
      const bet = parseBet(args[0]);
      if (!bet) { await replyEmbed(message, errorEmbed("Usage: `.slots <bet>`")); return; }
      if (user!.balance < bet) { await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user!.balance)}`)); return; }

      const fair = await getFairContext(user!.id);
      const honeypot = isHoneypotActive(user!.gameCount);
      const rolls = honeypot ? honeypotRolls(fair.rolls, user!.gameCount) : fair.rolls;
      const { reels, multiplier, won } = playSlots(rolls, false, honeypot);
      const grossWin = won ? Math.floor(bet * multiplier) : 0;
      const payout = won ? Math.floor((grossWin - bet) * HOUSE_EDGE) : -bet;
      const updated = await updateBalance(user!.id, payout, "slots", `Slots ${won ? "win" : "loss"}`);
      await incrementCounts(user!.id, false);
      const gameId = await saveGameRecord({ userId: user!.id, gameType: "slots", fair, bet, payout, resultData: { reels, multiplier, won }, isDemo: false });
      const display = `[ ${reels[0]} | ${reels[1]} | ${reels[2]} ]`;
      if (won) {
        await replyEmbed(message, winEmbed("🎰 Slots Win!", `${display}\n**${multiplier}x!** Won ${formatRobux(Math.abs(payout))}!\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
      } else {
        await replyEmbed(message, loseEmbed("🎰 No Match!", `${display}\nLost ${formatRobux(bet)}.\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
      }

    // ── ROULETTE ──────────────────────────────────────────────────────────────
    } else if (cmd === "rl" || cmd === "roulette") {
      const bet = parseBet(args[0]);
      const choice = args[1];
      if (!bet || !choice) { await replyEmbed(message, errorEmbed("Usage: `.rl <bet> <red/black/green/odd/even/low/high/0-36>`")); return; }
      const betChoice = parseRouletteBet(choice);
      if (betChoice === null) { await replyEmbed(message, errorEmbed("Invalid bet choice. Use: `red`, `black`, `green`, `odd`, `even`, `low`, `high`, or a number 0-36.")); return; }
      if (user!.balance < bet) { await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user!.balance)}`)); return; }

      const fair = await getFairContext(user!.id);
      const honeypot = isHoneypotActive(user!.gameCount);
      const roll = honeypot ? honeypotRoll(fair.roll, user!.gameCount) : fair.roll;
      const { number, color, won, multiplier } = playRoulette(betChoice, roll, honeypot);
      const grossWin = won ? bet * multiplier - bet : 0;
      const payout = won ? Math.floor(grossWin * HOUSE_EDGE) : -bet;
      const updated = await updateBalance(user!.id, payout, "roulette", `Roulette ${won ? "win" : "loss"} (${number})`);
      await incrementCounts(user!.id, false);
      const gameId = await saveGameRecord({ userId: user!.id, gameType: "roulette", fair, bet, payout, resultData: { betChoice, number, color, won, multiplier }, isDemo: false });
      const emoji = colorEmoji(color);
      if (won) {
        await replyEmbed(message, winEmbed("🎡 Roulette Win!", `${emoji} **${number} ${color}**! Won ${formatRobux(Math.abs(payout))} (${multiplier}x)!\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
      } else {
        await replyEmbed(message, loseEmbed("🎡 Roulette!", `${emoji} **${number} ${color}**! Lost ${formatRobux(bet)}.\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
      }

    // ── LEADERBOARD ───────────────────────────────────────────────────────────
    } else if (cmd === "lb" || cmd === "leaderboard") {
      const top = await getLeaderboard(false);
      const medals = ["🥇", "🥈", "🥉"];
      const lines = top.map((u, i) => `${medals[i] ?? `**${i + 1}.**`} **${u.username}** — ${formatRobux(u.balance)}`);
      await replyEmbed(message, baseEmbed("🏆 Leaderboard").setDescription(lines.join("\n") || "No players yet!"));

    // ── BLACKJACK / CRASH / MINES (require buttons — redirect to slash) ───────
    } else if (cmd === "bj" || cmd === "blackjack") {
      await replyEmbed(message, baseEmbed("🃏 Blackjack — Use Slash Command")
        .setDescription("Blackjack uses interactive buttons and requires a slash command.\n\nUse: `/blackjack bet:<amount>`"));
    } else if (cmd === "crash") {
      await replyEmbed(message, baseEmbed("🚀 Crash — Use Slash Command")
        .setDescription("Crash uses interactive buttons and requires a slash command.\n\nUse: `/crash bet:<amount>`"));
    } else if (cmd === "mines") {
      await replyEmbed(message, baseEmbed("💣 Mines — Use Slash Command")
        .setDescription("Mines uses an interactive grid and requires a slash command.\n\nUse: `/mines bet:<amount> mines:<1-15>`"));

    // ── AUTOBAN (owner only) ──────────────────────────────────────────────────
    } else if (cmd === "autoban") {
      if (!(await checkOwnerMessage(message))) {
        await replyEmbed(message, errorEmbed("This command is restricted to the bot owner."));
        return;
      }
      if (!message.guild) { await replyEmbed(message, errorEmbed("Must be used in a server.")); return; }
      const sub = args[0]?.toLowerCase();

      if (sub === "watch") {
        const messageId = args[1]?.trim();
        const channelId = args[2]?.trim() ?? message.channelId;
        const label = args.slice(3).join(" ").trim() || messageId;
        if (!messageId) { await replyEmbed(message, errorEmbed("Usage: `.autoban watch <message_id> [channel_id] [label]`")); return; }
        if (watchedMessages.has(messageId)) { await replyEmbed(message, errorEmbed(`Message \`${messageId}\` is already being watched.`)); return; }
        watchedMessages.set(messageId, { channelId, guildId: message.guild.id, watchedBy: message.author.id, label: label ?? messageId });
        await replyEmbed(message, winEmbed("👁️ Watch Started", `Anyone who reacts to \`${messageId}\` in <#${channelId}> will be **instantly banned**.\nLabel: **${label ?? messageId}**`));

      } else if (sub === "unwatch") {
        const messageId = args[1]?.trim();
        if (!messageId) { await replyEmbed(message, errorEmbed("Usage: `.autoban unwatch <message_id>`")); return; }
        if (!watchedMessages.has(messageId)) { await replyEmbed(message, errorEmbed(`Message \`${messageId}\` is not being watched.`)); return; }
        watchedMessages.delete(messageId);
        await replyEmbed(message, baseEmbed("✅ Stopped Watching").setDescription(`Message \`${messageId}\` is no longer watched.`));

      } else if (sub === "list") {
        if (watchedMessages.size === 0) {
          await replyEmbed(message, baseEmbed("👁️ Watched Messages").setDescription("No messages are currently being watched."));
          return;
        }
        const lines = [...watchedMessages.entries()].map(([id, w]) => `• \`${id}\` — **${w.label}** in <#${w.channelId}>`);
        await replyEmbed(message, baseEmbed(`👁️ Watching ${watchedMessages.size} message(s)`).setDescription(lines.join("\n")));
      } else {
        await replyEmbed(message, errorEmbed("Usage: `.autoban watch/unwatch/list`"));
      }

    // ── ADMIN (owner only) ────────────────────────────────────────────────────
    } else if (cmd === "admin") {
      if (!(await checkOwnerMessage(message))) {
        await replyEmbed(message, errorEmbed("This command is restricted to the bot owner."));
        return;
      }
      const sub = args[0]?.toLowerCase();
      const targetMention = args[1];
      const targetId = parseMention(targetMention);

      const ADMIN_USAGE = [
        "`.admin setbalance @user <amount>`",
        "`.admin addbalance @user <amount> [reason]`",
        "`.admin setdemo @user <amount>`",
        "`.admin resetbalance @user`",
        "`.admin lookup @user`",
        "`.admin txhistory @user [limit]`",
      ].join("\n");

      if (!sub) { await replyEmbed(message, baseEmbed("🔒 Admin Commands").setDescription(ADMIN_USAGE)); return; }
      if (!targetId) { await replyEmbed(message, errorEmbed(`Provide a valid @user mention.\n\n${ADMIN_USAGE}`)); return; }

      const targetUser = await message.client.users.fetch(targetId).catch(() => null);
      const targetName = targetUser?.username ?? targetId;

      if (sub === "setbalance") {
        const amount = parseBet(args[2]);
        if (amount === null) { await replyEmbed(message, errorEmbed("Usage: `.admin setbalance @user <amount>`")); return; }
        const existing = await getOrCreateUser(targetId, targetName);
        const diff = amount - existing.balance;
        await db.update(usersTable).set({ balance: amount }).where(eq(usersTable.id, targetId));
        await db.insert(transactionsTable).values({
          userId: targetId, type: "admin_setbalance", amount: diff,
          balanceBefore: existing.balance, balanceAfter: amount,
          description: `Admin set balance to ${amount} (by ${message.author.username})`,
        });
        await replyEmbed(message, winEmbed("💰 Balance Set", `**${targetName}**: ${formatRobux(existing.balance)} → ${formatRobux(amount)}`));

      } else if (sub === "addbalance") {
        const amount = parseInt(args[2]);
        if (isNaN(amount)) { await replyEmbed(message, errorEmbed("Usage: `.admin addbalance @user <amount> [reason]`")); return; }
        const reason = args.slice(3).join(" ") || `Admin adjustment by ${message.author.username}`;
        const existing = await getOrCreateUser(targetId, targetName);
        if (existing.balance + amount < 0) {
          await replyEmbed(message, errorEmbed(`This would make the balance negative. Current: ${formatRobux(existing.balance)}`)); return;
        }
        const updated = await updateBalance(targetId, amount, "admin_adjustment", reason);
        await replyEmbed(message, winEmbed(`💰 Balance ${amount >= 0 ? "Added" : "Deducted"}`,
          `**${targetName}**: ${formatRobux(existing.balance)} → ${formatRobux(updated.balance)}\n**Reason:** ${reason}`));

      } else if (sub === "setdemo") {
        const amount = parseBet(args[2]);
        if (amount === null) { await replyEmbed(message, errorEmbed("Usage: `.admin setdemo @user <amount>`")); return; }
        const existing = await getOrCreateUser(targetId, targetName);
        const diff = amount - existing.demoBalance;
        await db.update(usersTable).set({ demoBalance: amount }).where(eq(usersTable.id, targetId));
        await db.insert(transactionsTable).values({
          userId: targetId, type: "admin_setdemo", amount: diff,
          balanceBefore: existing.demoBalance, balanceAfter: amount,
          description: `Admin set demo balance to ${amount} (by ${message.author.username})`,
        });
        await replyEmbed(message, winEmbed("🎮 Demo Balance Set", `**${targetName}**: ${formatRobux(existing.demoBalance)} → ${formatRobux(amount)}`));

      } else if (sub === "resetbalance") {
        const existing = await getOrCreateUser(targetId, targetName);
        await db.update(usersTable).set({ balance: 0 }).where(eq(usersTable.id, targetId));
        await db.insert(transactionsTable).values({
          userId: targetId, type: "admin_resetbalance", amount: -existing.balance,
          balanceBefore: existing.balance, balanceAfter: 0,
          description: `Admin reset balance to 0 (by ${message.author.username})`,
        });
        await replyEmbed(message, baseEmbed("🔄 Balance Reset").setDescription(`**${targetName}**'s balance reset from ${formatRobux(existing.balance)} to ${formatRobux(0)}.`));

      } else if (sub === "lookup") {
        const rows = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
        if (rows.length === 0) { await replyEmbed(message, errorEmbed(`${targetName} has no profile yet.`)); return; }
        const u = rows[0];
        const net = u.totalWon - u.totalLost;
        const embed = new EmbedBuilder().setTitle(`🔍 Lookup — ${u.username}`).setColor(BOT_COLOR)
          .addFields(
            { name: "ID", value: `\`${u.id}\``, inline: true },
            { name: "💰 Balance", value: formatRobux(u.balance), inline: true },
            { name: "🎮 Demo", value: formatRobux(u.demoBalance), inline: true },
            { name: "Won", value: formatRobux(u.totalWon), inline: true },
            { name: "Lost", value: formatRobux(u.totalLost), inline: true },
            { name: "Net P/L", value: `${net >= 0 ? "+" : ""}${formatRobux(Math.abs(net))}`, inline: true },
            { name: "Games", value: `${u.gameCount}`, inline: true },
            { name: "Invites", value: `${u.inviteCount}`, inline: true },
            { name: "Affiliate Code", value: u.affiliateCode ?? "N/A", inline: true },
            { name: "Affiliate Earnings", value: formatRobux(u.affiliateTotalEarned), inline: true },
            { name: "Referrals", value: `${u.affiliateCount}`, inline: true },
            { name: "Referred By", value: u.affiliateOf ? `<@${u.affiliateOf}>` : "None", inline: true },
          ).setTimestamp();
        await replyEmbed(message, embed);

      } else if (sub === "txhistory") {
        const limit = Math.min(parseInt(args[2]) || 10, 20);
        const rows = await db.select().from(transactionsTable)
          .where(eq(transactionsTable.userId, targetId))
          .orderBy(desc(transactionsTable.createdAt))
          .limit(limit);
        if (rows.length === 0) { await replyEmbed(message, baseEmbed(`📜 Transactions — ${targetName}`).setDescription("No transactions found.")); return; }
        const lines = rows.map((tx, i) => {
          const sign = tx.amount >= 0 ? "+" : "";
          const ts = Math.floor(new Date(tx.createdAt).getTime() / 1000);
          return `\`${i + 1}.\` <t:${ts}:R> **${sign}${tx.amount.toLocaleString()}** — \`${tx.type}\``;
        });
        await replyEmbed(message, baseEmbed(`📜 Last ${rows.length} Txns — ${targetName}`).setDescription(lines.join("\n")));

      } else {
        await replyEmbed(message, baseEmbed("🔒 Admin Commands").setDescription(ADMIN_USAGE));
      }

    // ── ROLESTRIKE (owner only) ───────────────────────────────────────────────
    } else if (cmd === "rolestrike") {
      if (!(await checkOwnerMessage(message))) {
        await replyEmbed(message, errorEmbed("This command is restricted to the bot owner."));
        return;
      }
      if (!message.guild) return;
      const sub = args[0]?.toLowerCase();

      const RS_USAGE = [
        "`.rolestrike watch <msg_id> <role_id> [chan_id] [label]`",
        "`.rolestrike unwatch <msg_id>`",
        "`.rolestrike list`",
      ].join("\n");

      if (sub === "watch") {
        const messageId = args[1]?.trim();
        const roleIdOrMention = args[2]?.trim();
        const channelId = args[3]?.trim() ?? message.channelId;
        const label = args.slice(4).join(" ").trim() || messageId;

        if (!messageId || !roleIdOrMention) {
          await replyEmbed(message, errorEmbed(`Usage:\n${RS_USAGE}`));
          return;
        }

        // Accept raw role ID or <@&...> mention
        const roleId = roleIdOrMention.replace(/^<@&(\d+)>$/, "$1");
        const role = message.guild.roles.cache.get(roleId) ?? await message.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          await replyEmbed(message, errorEmbed(`Role not found: \`${roleIdOrMention}\`. Provide the role ID or mention.`));
          return;
        }

        if (roleStrikeWatches.has(messageId)) {
          await replyEmbed(message, errorEmbed(`Message \`${messageId}\` is already being watched.`));
          return;
        }

        roleStrikeWatches.set(messageId, {
          channelId,
          guildId: message.guild.id,
          roleId: role.id,
          watchedBy: message.author.id,
          label: label ?? messageId,
        });

        await replyEmbed(message, winEmbed("🎭 Rolestrike Watch Started",
          `React to \`${messageId}\` in <#${channelId}> → **all roles stripped** + get <@&${role.id}>\n**Label:** ${label ?? messageId}`));

      } else if (sub === "unwatch") {
        const messageId = args[1]?.trim();
        if (!messageId) { await replyEmbed(message, errorEmbed("Usage: `.rolestrike unwatch <msg_id>`")); return; }
        if (!roleStrikeWatches.has(messageId)) { await replyEmbed(message, errorEmbed(`Message \`${messageId}\` is not being watched.`)); return; }
        roleStrikeWatches.delete(messageId);
        await replyEmbed(message, baseEmbed("✅ Rolestrike Watch Removed").setDescription(`Message \`${messageId}\` is no longer watched.`));

      } else if (sub === "list") {
        if (roleStrikeWatches.size === 0) {
          await replyEmbed(message, baseEmbed("🎭 Rolestrike Watches").setDescription("No active rolestrike watches."));
          return;
        }
        const lines = [...roleStrikeWatches.entries()].map(([id, w]) =>
          `• \`${id}\` — **${w.label}** in <#${w.channelId}> → <@&${w.roleId}>`
        );
        await replyEmbed(message, baseEmbed(`🎭 ${roleStrikeWatches.size} Active Watch(es)`).setDescription(lines.join("\n")));

      } else {
        await replyEmbed(message, baseEmbed("🎭 Rolestrike").setDescription(RS_USAGE));
      }

    // ── AUTORESPONDER (owner only) ────────────────────────────────────────────
    } else if (cmd === "autoresponder" || cmd === "ar") {
      if (!(await checkOwnerMessage(message))) {
        await replyEmbed(message, errorEmbed("This command is restricted to the bot owner."));
        return;
      }
      const sub = args[0]?.toLowerCase();

      const AR_USAGE = [
        "`.ar add <trigger> | <response> [| exact|contains|startswith]`",
        "`.ar remove <trigger>`",
        "`.ar list`",
        "`.ar clear`",
      ].join("\n");

      if (sub === "add") {
        // Format: .ar add trigger | response [| matchtype]
        const rest = args.slice(1).join(" ");
        const parts = rest.split("|").map(s => s.trim());
        const trigger = parts[0];
        const response = parts[1];
        const matchType = (parts[2]?.toLowerCase() ?? "contains") as "exact" | "contains" | "startswith";

        if (!trigger || !response) {
          await replyEmbed(message, errorEmbed(`Usage:\n${AR_USAGE}\n\n**Example:**\n\`.ar add hello | Hello there! | contains\``));
          return;
        }
        if (!["exact", "contains", "startswith"].includes(matchType)) {
          await replyEmbed(message, errorEmbed("Match type must be `exact`, `contains`, or `startswith`."));
          return;
        }

        const key = trigger.toLowerCase();
        if (autoResponders.has(key)) {
          await replyEmbed(message, errorEmbed(`Trigger \`${trigger}\` already exists. Remove it first with \`.ar remove ${trigger}\``));
          return;
        }

        autoResponders.set(key, { trigger, response, matchType, createdAt: Date.now() });
        const matchLabel = { exact: "Exact match", contains: "Contains", startswith: "Starts with" }[matchType];
        await replyEmbed(message, winEmbed("✅ Autoresponder Added",
          `**Trigger:** \`${trigger}\`\n**Match:** ${matchLabel}\n**Response:** ${response}\n\nTotal active: **${autoResponders.size}**`));

      } else if (sub === "remove") {
        const trigger = args.slice(1).join(" ").trim().toLowerCase();
        if (!trigger) { await replyEmbed(message, errorEmbed("Usage: `.ar remove <trigger>`")); return; }
        if (!autoResponders.has(trigger)) { await replyEmbed(message, errorEmbed(`No autoresponder found for \`${trigger}\`.`)); return; }
        autoResponders.delete(trigger);
        await replyEmbed(message, baseEmbed("🗑️ Removed").setDescription(`Trigger \`${trigger}\` deleted. Remaining: **${autoResponders.size}**`));

      } else if (sub === "list") {
        if (autoResponders.size === 0) {
          await replyEmbed(message, baseEmbed("🤖 Autoresponders").setDescription("None set up yet. Use `.ar add trigger | response` to create one."));
          return;
        }
        const matchIcon: Record<string, string> = { exact: "🎯", contains: "🔍", startswith: "▶️" };
        const lines = [...autoResponders.values()]
          .sort((a, b) => a.trigger.localeCompare(b.trigger))
          .slice(0, 20)
          .map((ar, i) => `\`${i + 1}.\` ${matchIcon[ar.matchType]} \`${ar.trigger}\` → ${ar.response.slice(0, 60)}${ar.response.length > 60 ? "…" : ""}`);
        await replyEmbed(message, baseEmbed(`🤖 Autoresponders (${autoResponders.size})`).setDescription(lines.join("\n")));

      } else if (sub === "clear") {
        const count = autoResponders.size;
        if (count === 0) { await replyEmbed(message, baseEmbed("Nothing to clear").setDescription("No autoresponders active.")); return; }
        autoResponders.clear();
        await replyEmbed(message, baseEmbed("🗑️ Cleared").setDescription(`Removed all **${count}** autoresponder(s).`));

      } else {
        await replyEmbed(message, baseEmbed("🤖 Autoresponder").setDescription(AR_USAGE));
      }

    // ── BROADCAST (owner only) ────────────────────────────────────────────────
    } else if (cmd === "broadcast" || cmd === "bc") {
      if (!(await checkOwnerMessage(message))) {
        await replyEmbed(message, errorEmbed("This command is restricted to the bot owner."));
        return;
      }
      if (!message.guild) return;

      // Format: .broadcast #channel Title | Body text
      const channelMentionOrId = args[0];
      const rest = args.slice(1).join(" ");
      const parts = rest.split("|").map(s => s.trim());
      const hasPipe = parts.length >= 2;
      const title = hasPipe ? parts[0] || undefined : undefined;
      const body = hasPipe ? parts[1] : parts[0];

      if (!channelMentionOrId || !body) {
        await replyEmbed(message, errorEmbed(
          "Usage:\n`.broadcast #channel Message body`\n`.broadcast #channel Title | Message body`\n\n**Example:**\n`.bc #general Server is back online!`\n`.bc #announcements 🎉 Giveaway! | React below to enter.`"
        ));
        return;
      }

      const channelId = channelMentionOrId.replace(/^<#(\d+)>$/, "$1");
      const targetChannel = message.guild.channels.cache.get(channelId);
      if (!targetChannel || !targetChannel.isTextBased()) {
        await replyEmbed(message, errorEmbed(`Channel not found or not a text channel: \`${channelMentionOrId}\``));
        return;
      }

      const embed = new EmbedBuilder().setColor(BOT_COLOR).setDescription(body).setTimestamp();
      if (title) embed.setTitle(title);

      await (targetChannel as any).send({ embeds: [embed] });
      await replyEmbed(message, winEmbed("📣 Broadcast Sent", `Message delivered to <#${channelId}>.`));

    // ── BANREACTERS (owner only) ───────────────────────────────────────────────
    } else if (cmd === "banreacters") {
      if (!(await checkOwnerMessage(message))) {
        await replyEmbed(message, errorEmbed("This command is restricted to the bot owner."));
        return;
      }
      if (!message.guild) { await replyEmbed(message, errorEmbed("Must be used in a server.")); return; }
      const messageId = args[0]?.trim();
      const channelId = args[1]?.trim() ?? message.channelId;
      if (!messageId) { await replyEmbed(message, errorEmbed("Usage: `.banreacters <message_id> [channel_id]`")); return; }

      const loadingMsg = await message.reply({ content: "⏳ Fetching reactions…" });
      const channel = await message.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) { await loadingMsg.edit("❌ Channel not found."); return; }
      const targetMsg = await (channel as any).messages.fetch(messageId, { force: true }).catch(() => null);
      if (!targetMsg) { await loadingMsg.edit(`❌ Message \`${messageId}\` not found.`); return; }

      const reacterIds = new Set<string>();
      for (const [, reaction] of targetMsg.reactions.cache) {
        let users = await reaction.users.fetch();
        for (const [uid, u] of users) { if (!u.bot) reacterIds.add(uid); }
        while (users.size === 100) {
          const lastId = [...users.keys()].pop()!;
          users = await reaction.users.fetch({ after: lastId });
          for (const [uid, u] of users) { if (!u.bot) reacterIds.add(uid); }
        }
      }
      reacterIds.delete(message.client.user!.id);
      reacterIds.delete(message.author.id);

      if (reacterIds.size === 0) { await loadingMsg.edit("No non-bot users found who reacted."); return; }

      let banned = 0, failed = 0;
      for (const uid of reacterIds) {
        try {
          await message.guild.members.ban(uid, { reason: `[BanReacters] Reacted on ${messageId} — by ${message.author.username}` });
          banned++;
        } catch { failed++; }
      }
      await loadingMsg.edit({ content: "", embeds: [new EmbedBuilder().setTitle("🔨 Ban Complete").setColor(0xff4444)
        .addFields(
          { name: "Total Reacters", value: `${reacterIds.size}`, inline: true },
          { name: "✅ Banned", value: `${banned}`, inline: true },
          { name: "❌ Failed", value: `${failed}`, inline: true },
        ).setTimestamp()] });
    }

  } catch (err: any) {
    console.error("[PrefixHandler Error]", err?.message ?? err);
    await message.reply({ content: "❌ Something went wrong. Please try again." }).catch(() => {});
  }
}
