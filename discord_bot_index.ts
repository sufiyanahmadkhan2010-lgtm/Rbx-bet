import { Client, GatewayIntentBits, Collection, Events, Interaction, Message } from "discord.js";
import { handleTicketButton } from "./handlers/ticketHandler";
import { handlePrefixMessage } from "./handlers/prefixHandler";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getOrCreateUser, updateBalance } from "./utils/db";

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
import { watchedMessages } from "./commands/autoban";

type Command = { data: { name: string; toJSON: () => unknown }; execute: (i: any) => Promise<void> };

const commands = new Collection<string, Command>();
const allCommands: Command[] = [
  balance, daily, demo, coinflip, slots, blackjack, roulette, leaderboard,
  deposit, withdraw, give, stats, verify, setseed, promo, affiliate, statusbonus, banreacters, crash, mines, autoban,
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

const MESSAGE_REWARD_AMOUNT = 5;
const MESSAGE_REWARD_COOLDOWN_MS = 60 * 1000;
const MESSAGE_REWARD_THRESHOLD = 5;
const messageCounters = new Map<string, { count: number; lastReset: number }>();
const inviteCache = new Map<string, number>();

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot ready as ${c.user.tag}`);
  for (const [, guild] of c.guilds.cache) {
    try {
      const invites = await guild.invites.fetch();
      for (const [code, invite] of invites) {
        inviteCache.set(code, invite.uses ?? 0);
      }
    } catch {}
  }
});

// Auto-ban: instantly ban anyone who reacts to a watched message
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (user.partial) await user.fetch();
  } catch { return; }

  const watch = watchedMessages.get(reaction.message.id);
  if (!watch) return;

  const guild = client.guilds.cache.get(watch.guildId);
  if (!guild) return;

  try {
    await guild.members.ban(user.id, { reason: `[AutoBan] Reacted to watched message (${watch.label})` });
    console.log(`[AutoBan] Banned ${user.tag ?? user.id} for reacting to ${watch.label}`);

    // DM the owner
    const owner = await client.users.fetch(watch.watchedBy).catch(() => null);
    if (owner) {
      await owner.send(`🔨 **AutoBan:** Banned **${user.tag ?? user.id}** for reacting to \`${watch.label}\``).catch(() => {});
    }
  } catch (err: any) {
    console.error(`[AutoBan] Failed to ban ${user.id}:`, err.message);
  }
});

client.on(Events.InviteCreate, (invite) => {
  inviteCache.set(invite.code, invite.uses ?? 0);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const invites = await member.guild.invites.fetch();
    for (const [code, invite] of invites) {
      const oldUses = inviteCache.get(code) ?? 0;
      if ((invite.uses ?? 0) > oldUses && invite.inviter) {
        inviteCache.set(code, invite.uses ?? 0);
        const inviter = invite.inviter;
        await getOrCreateUser(inviter.id, inviter.username);
        await db.update(usersTable)
          .set({ inviteCount: sql`${usersTable.inviteCount} + 1` })
          .where(eq(usersTable.id, inviter.id));
        await updateBalance(inviter.id, 200, "invite_reward", `Invited ${member.user.username}`);
        try { await inviter.send(`🎉 You earned **200 Robux** for inviting **${member.user.username}**!`); } catch {}
        break;
      }
    }
  } catch {}
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot || !message.guild) return;

  // Handle prefix commands
  if (message.content.startsWith(".")) {
    await handlePrefixMessage(message).catch(err => console.error("Prefix handler error:", err));
    return;
  }

  const userId = message.author.id;
  const now = Date.now();
  let counter = messageCounters.get(userId);
  if (!counter || now - counter.lastReset > MESSAGE_REWARD_COOLDOWN_MS) {
    counter = { count: 0, lastReset: now };
  }
  counter.count++;
  messageCounters.set(userId, counter);

  await db.update(usersTable)
    .set({ messageCount: sql`${usersTable.messageCount} + 1` })
    .where(eq(usersTable.id, userId))
    .catch(() => {});

  if (counter.count >= MESSAGE_REWARD_THRESHOLD) {
    counter.count = 0;
    counter.lastReset = now;
    messageCounters.set(userId, counter);
    try {
      await getOrCreateUser(userId, message.author.username);
      await updateBalance(userId, MESSAGE_REWARD_AMOUNT, "message_reward", "Message activity reward");
    } catch {}
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id.startsWith("ticket_approve_") || id.startsWith("ticket_deny_") || id === "ticket_close") {
      await handleTicketButton(interaction).catch(err => {
        console.error("Ticket button error:", err);
        interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => {});
      });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const msg = { content: "Something went wrong running that command.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
