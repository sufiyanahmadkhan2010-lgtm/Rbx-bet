import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { errorEmbed, winEmbed, baseEmbed } from "../utils/embed";
import { checkOwnerInteraction } from "../utils/admin";

export const data = new SlashCommandBuilder()
  .setName("banreacters")
  .setDescription("[Owner only] Ban every user who reacted to a message")
  .addStringOption(opt =>
    opt.setName("message_id").setDescription("The ID of the message to check reactions on").setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName("channel_id").setDescription("Channel ID (defaults to current channel)").setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName("dry_run").setDescription("Preview who would be banned without actually banning (default: false)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!(await checkOwnerInteraction(interaction))) {
    await interaction.reply({ content: "❌ This command is restricted to the bot owner.", flags: 64 });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", flags: 64 });
    return;
  }

  const messageId = interaction.options.getString("message_id", true).trim();
  const channelId = interaction.options.getString("channel_id")?.trim() ?? interaction.channelId;
  const dryRun = interaction.options.getBoolean("dry_run") ?? false;

  await interaction.deferReply({ flags: 64 });

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply({ embeds: [errorEmbed("Channel not found or not a text channel.")] });
    return;
  }

  const message = await (channel as any).messages.fetch(messageId, { force: true }).catch(() => null);
  if (!message) {
    await interaction.editReply({ embeds: [errorEmbed(`Message \`${messageId}\` not found in <#${channelId}>.`)] });
    return;
  }

  const reactionKeys = [...message.reactions.cache.keys()];
  for (const key of reactionKeys) {
    await message.reactions.cache.get(key)?.fetch().catch(() => {});
  }

  if (message.reactions.cache.size === 0) {
    await interaction.editReply({ embeds: [baseEmbed("No Reactions").setDescription(`That message has no reactions.\n\nMessage ID: \`${messageId}\` in <#${channelId}>`)] });
    return;
  }

  const reacterIds = new Set<string>();

  for (const [, reaction] of message.reactions.cache) {
    let users = await reaction.users.fetch();
    reacterIds.add(interaction.client.user!.id);
    for (const [uid, user] of users) {
      if (!user.bot) reacterIds.add(uid);
    }
    while (users.size === 100) {
      const lastId = [...users.keys()].pop()!;
      users = await reaction.users.fetch({ after: lastId });
      for (const [uid, user] of users) {
        if (!user.bot) reacterIds.add(uid);
      }
    }
  }

  reacterIds.delete(interaction.client.user!.id);
  reacterIds.delete(interaction.user.id);

  if (reacterIds.size === 0) {
    await interaction.editReply({ embeds: [baseEmbed("Nothing to do").setDescription("No non-bot users found who reacted.")] });
    return;
  }

  const userList = [...reacterIds];

  if (dryRun) {
    const mentions = userList.map(id => `<@${id}>`).join(", ");
    await interaction.editReply({
      embeds: [baseEmbed(`🔍 Dry Run — ${userList.length} user(s) would be banned`)
        .setDescription(mentions.slice(0, 2000))
        .setFooter({ text: "Run without dry_run:true to actually ban them." })],
    });
    return;
  }

  let banned = 0;
  let failed = 0;
  const failedList: string[] = [];

  for (const uid of userList) {
    try {
      await interaction.guild.members.ban(uid, { reason: `[AutoBan] Reacted on message ${messageId} — banned by ${interaction.user.username}` });
      banned++;
    } catch {
      failed++;
      failedList.push(uid);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`🔨 Ban Complete`)
    .setColor(banned > 0 ? 0xff4444 : 0xffaa00)
    .addFields(
      { name: "Message", value: `[Jump](https://discord.com/channels/${interaction.guild.id}/${channelId}/${messageId})`, inline: true },
      { name: "Total Reacters", value: `${userList.length}`, inline: true },
      { name: "✅ Banned", value: `${banned}`, inline: true },
    );

  if (failed > 0) {
    embed.addFields({ name: `❌ Failed (${failed})`, value: failedList.map(id => `<@${id}>`).join(", ").slice(0, 1024) });
  }

  embed.setTimestamp().setFooter({ text: `Requested by ${interaction.user.username}` });
  await interaction.editReply({ embeds: [embed] });
}
