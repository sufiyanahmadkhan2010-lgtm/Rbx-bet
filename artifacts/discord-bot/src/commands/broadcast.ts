import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, TextChannel } from "discord.js";
import { errorEmbed, baseEmbed, winEmbed, BOT_COLOR } from "../utils/embed";
import { checkOwnerInteraction } from "../utils/admin";

const COLOR_MAP: Record<string, number> = {
  red: 0xff4444,
  green: 0x44ff88,
  blue: 0x4488ff,
  yellow: 0xffcc00,
  orange: 0xff8800,
  purple: 0xaa44ff,
  pink: 0xff44aa,
  white: 0xffffff,
  black: 0x23272a,
  gold: 0xffd700,
  default: BOT_COLOR,
};

export const data = new SlashCommandBuilder()
  .setName("broadcast")
  .setDescription("[Owner only] Send a custom embed to any channel")
  .addChannelOption(opt =>
    opt.setName("channel").setDescription("Channel to send the message in").setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName("message").setDescription("The body/description of the embed").setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName("title").setDescription("Embed title (optional)").setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName("color")
      .setDescription("Embed color (optional, default: bot color)")
      .setRequired(false)
      .addChoices(
        { name: "🔴 Red", value: "red" },
        { name: "🟢 Green", value: "green" },
        { name: "🔵 Blue", value: "blue" },
        { name: "🟡 Yellow", value: "yellow" },
        { name: "🟠 Orange", value: "orange" },
        { name: "🟣 Purple", value: "purple" },
        { name: "🩷 Pink", value: "pink" },
        { name: "⚪ White", value: "white" },
        { name: "🏆 Gold", value: "gold" },
        { name: "🤖 Default (bot color)", value: "default" },
      )
  )
  .addStringOption(opt =>
    opt.setName("footer").setDescription("Footer text (optional)").setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName("image").setDescription("Image URL to attach at the bottom (optional)").setRequired(false)
  )
  .addBooleanOption(opt =>
    opt.setName("ping_everyone").setDescription("Ping @everyone before the embed (default: false)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!(await checkOwnerInteraction(interaction))) {
      await interaction.reply({ content: "❌ This command is restricted to the bot owner.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    const channel = interaction.options.getChannel("channel", true);
    const bodyText = interaction.options.getString("message", true);
    const title = interaction.options.getString("title") ?? undefined;
    const colorKey = interaction.options.getString("color") ?? "default";
    const footer = interaction.options.getString("footer") ?? undefined;
    const imageUrl = interaction.options.getString("image") ?? undefined;
    const pingEveryone = interaction.options.getBoolean("ping_everyone") ?? false;

    const textChannel = interaction.guild?.channels.cache.get(channel.id) as TextChannel | undefined;
    if (!textChannel || !textChannel.isTextBased()) {
      await interaction.editReply({ embeds: [errorEmbed("That channel is not a text channel or couldn't be found.")] });
      return;
    }

    const color = COLOR_MAP[colorKey] ?? BOT_COLOR;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setDescription(bodyText)
      .setTimestamp();

    if (title) embed.setTitle(title);
    if (footer) embed.setFooter({ text: footer });
    if (imageUrl) {
      try {
        new URL(imageUrl);
        embed.setImage(imageUrl);
      } catch {
        await interaction.editReply({ embeds: [errorEmbed(`Invalid image URL: \`${imageUrl}\``)] });
        return;
      }
    }

    if (pingEveryone) {
      await textChannel.send({ content: "@everyone" });
    }

    await textChannel.send({ embeds: [embed] });

    await interaction.editReply({
      embeds: [winEmbed("📣 Broadcast Sent", [
        `**Channel:** <#${channel.id}>`,
        title ? `**Title:** ${title}` : null,
        `**Color:** ${colorKey}`,
        pingEveryone ? "**@everyone** pinged" : null,
      ].filter(Boolean).join("\n"))],
    });

  } catch (err: any) {
    console.error("[Broadcast Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Failed to send broadcast. Check the bot has permission to send messages in that channel.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], flags: 64 });
    } catch {}
  }
}
