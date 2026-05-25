import { Client, GatewayIntentBits, Collection, Events, Interaction, Message } from "discord.js";
import { handleTicketButton } from "./handlers/ticketHandler";
import { handlePrefixMessage } from "./handlers/prefixHandler";
import express from "express";

import * as balance from "./commands/balance";
import * as daily from "./commands/daily";
import * as demo from "./commands/demo";
import * as coinflip from "./commands/coinflip";
import * as slots from "./commands/slots";
import * as blackjack from "./commands/blackjack";
import * as roulette from "./commands/roulette";
import * as leaderboard from "./commands/leaderboard";
import * as deposit from "./commands/deposit";
import * as withdraw from "./commands/withdraw";
import * as give from "./commands/give";
import * as stats from "./commands/stats";
import * as verify from "./commands/verify";
import * as setseed from "./commands/setseed";
import * as promo from "./commands/promo";
import * as affiliate from "./commands/affiliate";
import * as statusbonus from "./commands/statusbonus";
import * as banreacters from "./commands/banreacters";
import * as crash from "./commands/crash";
import * as mines from "./commands/mines";
import * as autoban from "./commands/autoban";
import * as ping from "./commands/ping";
import * as admin from "./commands/admin";
import * as rolestrike from "./commands/rolestrike";
import { watchedMessages } from "./commands/autoban";
import { roleStrikeWatches } from "./commands/rolestrike";

type Command = { data: { name: string; toJSON: () => unknown }; execute: (i: any) => Promise<void> };

const commands = new Collection<string, Command>();
const allCommands: Command[] = [
  balance, daily, demo, coinflip, slots, blackjack, roulette, leaderboard,
  deposit, withdraw, give, stats, verify, setseed, promo, affiliate, statusbonus, banreacters, crash, mines, autoban, ping, admin, rolestrike,
];
for (const cmd of allCommands) {
  commands.set(cmd.data.name, cmd);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot ready as ${c.user.tag}`);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (user.partial) await user.fetch();
  } catch { return; }

  const msgId = reaction.message.id;

  // ── AutoBan watcher ──────────────────────────────────────────────────────
  const autoBanWatch = watchedMessages.get(msgId);
  if (autoBanWatch) {
    const guild = client.guilds.cache.get(autoBanWatch.guildId);
    if (guild) {
      try {
        await guild.members.ban(user.id, { reason: `[AutoBan] Reacted to watched message (${autoBanWatch.label})` });
        console.log(`[AutoBan] Banned ${user.tag ?? user.id} for reacting to ${autoBanWatch.label}`);
        const owner = await client.users.fetch(autoBanWatch.watchedBy).catch(() => null);
        if (owner) await owner.send(`🔨 **AutoBan:** Banned **${user.tag ?? user.id}** for reacting to \`${autoBanWatch.label}\``).catch(() => {});
      } catch (err: any) {
        console.error(`[AutoBan] Failed to ban ${user.id}:`, err.message);
      }
    }
  }

  // ── RoleStrike watcher ───────────────────────────────────────────────────
  const rsWatch = roleStrikeWatches.get(msgId);
  if (rsWatch) {
    const guild = client.guilds.cache.get(rsWatch.guildId);
    if (!guild) return;

    try {
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      // Save the roles they had (excluding @everyone and the punishment role itself)
      const hadRoles = member.roles.cache
        .filter(r => r.id !== guild.id && r.id !== rsWatch.roleId)
        .map(r => r.name)
        .join(", ") || "none";

      // Strip all non-managed roles (can't remove bot-managed roles)
      const rolesToRemove = member.roles.cache.filter(r =>
        r.id !== guild.id && !r.managed
      );
      for (const [, role] of rolesToRemove) {
        await member.roles.remove(role, `[RoleStrike] Reacted to watched message (${rsWatch.label})`).catch(() => {});
      }

      // Assign punishment role
      await member.roles.add(rsWatch.roleId, `[RoleStrike] Reacted to watched message (${rsWatch.label})`).catch(() => {});

      console.log(`[RoleStrike] Struck ${user.tag ?? user.id} for reacting to ${rsWatch.label} — was: ${hadRoles}`);

      // DM the owner
      const owner = await client.users.fetch(rsWatch.watchedBy).catch(() => null);
      if (owner) {
        await owner.send(
          `🎭 **RoleStrike:** <@${user.id}> (**${user.tag ?? user.id}**) reacted to \`${rsWatch.label}\`.\n` +
          `Stripped their roles and assigned <@&${rsWatch.roleId}>.\n` +
          `**Had:** ${hadRoles}`
        ).catch(() => {});
      }
    } catch (err: any) {
      console.error(`[RoleStrike] Failed to process ${user.id}:`, err.message);
    }
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot || !message.guild) return;

  // Handle prefix commands
  if (message.content.startsWith(".")) {
    await handlePrefixMessage(message).catch(err => console.error("Prefix handler error:", err));
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id.startsWith("ticket_approve_") || id.startsWith("ticket_deny_") || id === "ticket_close") {
      await handleTicketButton(interaction).catch(err => {
        console.error("Ticket button error:", err);
        if (!interaction.replied && !interaction.deferred) {
          interaction.reply({ content: "Something went wrong.", flags: 64 }).catch(() => {});
        } else {
          interaction.followUp({ content: "Something went wrong.", flags: 64 }).catch(() => {});
        }
      });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err: any) {
    console.error(`Error in /${interaction.commandName}:`, err?.message ?? err);
    const msg = { content: "Something went wrong running that command.", flags: 64 };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    } catch {
      // Interaction likely expired — nothing we can do
    }
  }
});

// ── Anti-crash handlers ───────────────────────────────────────────────────────
process.on("unhandledRejection", (reason: unknown) => {
  console.error("[UnhandledRejection]", reason);
});

process.on("uncaughtException", (err: Error) => {
  console.error("[UncaughtException]", err.message, err.stack);
});

// ── Discord reconnect logging ─────────────────────────────────────────────────
client.on(Events.ShardDisconnect, (event, shardId) => {
  console.warn(`[Shard ${shardId}] Disconnected (code ${event.code}). Discord.js will reconnect automatically.`);
});

client.on(Events.ShardReconnecting, (shardId) => {
  console.log(`[Shard ${shardId}] Reconnecting...`);
});

client.on(Events.ShardResume, (shardId, replayedEvents) => {
  console.log(`[Shard ${shardId}] Resumed (replayed ${replayedEvents} events).`);
});

client.on(Events.Error, (err) => {
  console.error("[Client Error]", err.message);
});

// ── Express keep-alive server ─────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.send("Bot is alive");
});

app.listen(PORT, () => {
  console.log(`[Express] Keep-alive server listening on port ${PORT}`);
});

// ── Login ─────────────────────────────────────────────────────────────────────
const token = process.env.TOKEN ?? process.env.DISCORD_TOKEN;
if (!token) {
  console.error("[FATAL] No bot token found. Set TOKEN or DISCORD_TOKEN environment variable.");
  process.exit(1);
}

client.login(token);
