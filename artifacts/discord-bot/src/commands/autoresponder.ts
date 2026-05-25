import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { errorEmbed, baseEmbed, winEmbed, BOT_COLOR } from "../utils/embed";
import { checkOwnerInteraction } from "../utils/admin";

export interface AutoResponse {
  trigger: string;
  response: string;
  matchType: "exact" | "contains" | "startswith";
  createdAt: number;
}

// trigger (lowercased) -> AutoResponse
export const autoResponders = new Map<string, AutoResponse>();

export const data = new SlashCommandBuilder()
  .setName("autoresponder")
  .setDescription("[Owner only] Manage automatic message responses")
  .addSubcommand(sub => sub
    .setName("add")
    .setDescription("Add a new autoresponder trigger")
    .addStringOption(opt =>
      opt.setName("trigger").setDescription("The word or phrase to trigger on").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("response").setDescription("What the bot will reply with").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("match")
        .setDescription("How to match the trigger (default: contains)")
        .setRequired(false)
        .addChoices(
          { name: "contains — message includes the trigger anywhere", value: "contains" },
          { name: "exact — message IS the trigger exactly", value: "exact" },
          { name: "startswith — message starts with the trigger", value: "startswith" },
        )
    )
  )
  .addSubcommand(sub => sub
    .setName("remove")
    .setDescription("Remove an autoresponder by trigger")
    .addStringOption(opt =>
      opt.setName("trigger").setDescription("The trigger to remove").setRequired(true)
    )
  )
  .addSubcommand(sub => sub
    .setName("list")
    .setDescription("List all active autoresponders")
  )
  .addSubcommand(sub => sub
    .setName("clear")
    .setDescription("Remove ALL autoresponders at once")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!(await checkOwnerInteraction(interaction))) {
      await interaction.reply({ content: "❌ This command is restricted to the bot owner.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const trigger = interaction.options.getString("trigger", true).trim();
      const response = interaction.options.getString("response", true).trim();
      const matchType = (interaction.options.getString("match") ?? "contains") as AutoResponse["matchType"];
      const key = trigger.toLowerCase();

      if (autoResponders.has(key)) {
        const existing = autoResponders.get(key)!;
        await interaction.editReply({
          embeds: [errorEmbed(
            `A trigger already exists for \`${trigger}\`.\n\n` +
            `**Current response:** ${existing.response}\n\n` +
            `Remove it first with \`/autoresponder remove\` then add again.`
          )],
        });
        return;
      }

      autoResponders.set(key, { trigger, response, matchType, createdAt: Date.now() });

      const matchLabel = { exact: "Exact match", contains: "Contains", startswith: "Starts with" }[matchType];

      await interaction.editReply({
        embeds: [winEmbed("✅ Autoresponder Added", [
          `**Trigger:** \`${trigger}\``,
          `**Match type:** ${matchLabel}`,
          `**Response:** ${response}`,
          ``,
          `Total active: **${autoResponders.size}**`,
        ].join("\n"))],
      });

    } else if (sub === "remove") {
      const trigger = interaction.options.getString("trigger", true).trim().toLowerCase();

      if (!autoResponders.has(trigger)) {
        await interaction.editReply({
          embeds: [errorEmbed(`No autoresponder found for \`${trigger}\`. Use \`/autoresponder list\` to see all active triggers.`)],
        });
        return;
      }

      autoResponders.delete(trigger);
      await interaction.editReply({
        embeds: [baseEmbed("🗑️ Autoresponder Removed").setDescription(`Trigger \`${trigger}\` has been deleted.\nRemaining: **${autoResponders.size}**`)],
      });

    } else if (sub === "list") {
      if (autoResponders.size === 0) {
        await interaction.editReply({
          embeds: [baseEmbed("🤖 Autoresponders").setDescription("No autoresponders set up yet.\nUse `/autoresponder add` to create one.")],
        });
        return;
      }

      const matchIcon: Record<string, string> = { exact: "🎯", contains: "🔍", startswith: "▶️" };

      const entries = [...autoResponders.values()].sort((a, b) => a.trigger.localeCompare(b.trigger));
      const lines = entries.map((ar, i) =>
        `\`${i + 1}.\` ${matchIcon[ar.matchType]} \`${ar.trigger}\`\n    → ${ar.response.slice(0, 80)}${ar.response.length > 80 ? "…" : ""}`
      );

      // Split into pages of 10 if there are many
      const page = lines.slice(0, 15).join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🤖 Autoresponders (${autoResponders.size})`)
        .setColor(BOT_COLOR)
        .setDescription(page)
        .addFields({ name: "Legend", value: "🎯 Exact  •  🔍 Contains  •  ▶️ Starts with", inline: false })
        .setFooter({ text: entries.length > 15 ? `Showing 15 of ${entries.length}` : `${entries.length} total` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } else if (sub === "clear") {
      const count = autoResponders.size;
      if (count === 0) {
        await interaction.editReply({ embeds: [baseEmbed("Nothing to clear").setDescription("No autoresponders are active.")] });
        return;
      }
      autoResponders.clear();
      await interaction.editReply({
        embeds: [baseEmbed("🗑️ Cleared").setDescription(`Removed all **${count}** autoresponder(s).`)],
      });
    }

  } catch (err: any) {
    console.error("[Autoresponder Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], flags: 64 });
    } catch {}
  }
}
