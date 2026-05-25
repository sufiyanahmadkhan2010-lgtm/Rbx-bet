import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ComponentType, ButtonInteraction,
} from "discord.js";
import { getOrCreateUser, updateBalance, applyAffiliateBonus } from "../utils/db";
import { winEmbed, loseEmbed, errorEmbed, formatRobux, BOT_COLOR } from "../utils/embed";
import { calculateCrashPoint, getMultiplierAt, formatMultiplier, multiplierColor, rocketBar } from "../games/crash";
import { getFairContext, saveGameRecord } from "../utils/provably-fair";
import { isHoneypotActive } from "../utils/honeypot";
import { checkDemoExpiry, incrementCounts } from "../utils/gameUtils";

const HOUSE_EDGE = 0.96;
const TICK_MS = 1200;
const MAX_GAME_MS = 120_000;

export const activeGames = new Set<string>();

export const data = new SlashCommandBuilder()
  .setName("crash")
  .setDescription("Bet on a rising multiplier — cash out before it crashes!")
  .addIntegerOption(opt =>
    opt.setName("bet").setDescription("Amount to bet").setRequired(true).setMinValue(1)
  )
  .addBooleanOption(opt =>
    opt.setName("demo").setDescription("Use demo balance?").setRequired(false)
  );

function buildEmbed(username: string, bet: number, multiplier: number, crashPoint: number, isDemo: boolean, status: "live" | "crashed" | "cashed", cashoutAt?: number) {
  const label = isDemo ? "Demo Robux" : "Robux";
  const netProfit = Math.floor(bet * multiplier * HOUSE_EDGE) - bet;
  const displayProfit = netProfit >= 0 ? `+${formatRobux(netProfit)}` : formatRobux(netProfit);

  if (status === "live") {
    return new EmbedBuilder()
      .setTitle(`🚀 CRASH — ${formatMultiplier(multiplier)}`)
      .setColor(multiplierColor(multiplier))
      .setDescription([
        `\`\`\``,
        `  ${formatMultiplier(multiplier).padStart(8)}`,
        `\`\`\``,
        rocketBar(multiplier, crashPoint),
      ].join("\n"))
      .addFields(
        { name: "Bet", value: formatRobux(bet), inline: true },
        { name: "Profit if cashed now", value: displayProfit, inline: true },
        { name: "Mode", value: isDemo ? "🎮 Demo" : "💰 Real", inline: true },
      )
      .setFooter({ text: `${username} • Click Cash Out to secure your winnings!` });

  } else if (status === "crashed") {
    return new EmbedBuilder()
      .setTitle(`💥 CRASHED at ${formatMultiplier(crashPoint)}`)
      .setColor(0xff0000)
      .setDescription(`The rocket exploded! You lost ${formatRobux(bet)} ${label}.`)
      .addFields(
        { name: "Bet", value: formatRobux(bet), inline: true },
        { name: "Crash Point", value: formatMultiplier(crashPoint), inline: true },
      )
      .setFooter({ text: `${username} • Better luck next time!` })
      .setTimestamp();

  } else {
    const won = Math.floor(bet * cashoutAt! * HOUSE_EDGE);
    const profit = won - bet;
    return new EmbedBuilder()
      .setTitle(`💰 Cashed Out at ${formatMultiplier(cashoutAt!)}`)
      .setColor(0x00ff88)
      .setDescription(`Secured ${formatRobux(won)} ${label}! (${profit >= 0 ? "+" : ""}${formatRobux(Math.abs(profit))})`)
      .addFields(
        { name: "Bet", value: formatRobux(bet), inline: true },
        { name: "Cashout Multiplier", value: formatMultiplier(cashoutAt!), inline: true },
        { name: "Payout", value: formatRobux(won), inline: true },
      )
      .setFooter({ text: `${username} • Crashed at ${formatMultiplier(crashPoint)}` })
      .setTimestamp();
  }
}

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    const bet = interaction.options.getInteger("bet", true);
    const isDemo = interaction.options.getBoolean("demo") ?? false;
    const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

    if (isDemo) { if (await checkDemoExpiry(user, interaction)) return; }

    const balance = isDemo ? user.demoBalance : user.balance;
    const label = isDemo ? "Demo Robux" : "Robux";
    if (balance < bet) {
      await interaction.reply({ embeds: [errorEmbed(`Not enough ${label}! Balance: ${formatRobux(balance)}`)], flags: 64 });
      return;
    }
    if (activeGames.has(interaction.user.id)) {
      await interaction.reply({ embeds: [errorEmbed("You already have an active crash game!")], flags: 64 });
      return;
    }

    await interaction.deferReply();

    const fair = await getFairContext(interaction.user.id);
    const honeypot = !isDemo && isHoneypotActive(user.gameCount);
    const crashPoint = calculateCrashPoint(fair.serverSeed, fair.nonce, honeypot);

    activeGames.add(interaction.user.id);
    const startTime = Date.now();
    let active = true;

    const cashOutRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`crash_cashout_${interaction.user.id}`)
        .setLabel("💸 Cash Out")
        .setStyle(ButtonStyle.Success),
    );
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`crash_cashout_${interaction.user.id}_done`)
        .setLabel("💸 Cash Out")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    const initialEmbed = buildEmbed(interaction.user.username, bet, 1.00, crashPoint, isDemo, "live");
    const message = await interaction.editReply({ embeds: [initialEmbed], components: [cashOutRow] });
    if (!message) { activeGames.delete(interaction.user.id); return; }

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: i => i.customId === `crash_cashout_${interaction.user.id}` && i.user.id === interaction.user.id,
      time: MAX_GAME_MS,
    });

    const endGame = async (cashedOut: boolean, cashoutMultiplier?: number) => {
      if (!active) return;
      active = false;
      activeGames.delete(interaction.user.id);
      clearInterval(ticker);
      collector.stop();
      await incrementCounts(interaction.user.id, isDemo);

      if (cashedOut && cashoutMultiplier !== undefined) {
        const payout = Math.floor(bet * cashoutMultiplier * HOUSE_EDGE);
        const profit = payout - bet;
        const updated = await updateBalance(interaction.user.id, profit, "crash_win", `Crash cashout at ${formatMultiplier(cashoutMultiplier)}`, isDemo);
        if (!isDemo) await applyAffiliateBonus(interaction.user.id, profit > 0 ? profit : 0);
        const newBal = isDemo ? updated.demoBalance : updated.balance;
        const gameId = await saveGameRecord({ userId: interaction.user.id, gameType: "crash", fair, bet, payout: profit, resultData: { cashoutMultiplier, crashPoint, won: true }, isDemo });
        const embed = buildEmbed(interaction.user.username, bet, cashoutMultiplier, crashPoint, isDemo, "cashed", cashoutMultiplier)
          .setFooter({ text: `Game ID: ${gameId} • /verify ${gameId} • Crashed at ${formatMultiplier(crashPoint)}` });
        await message.edit({ embeds: [embed], components: [disabledRow] });
      } else {
        const updated = await updateBalance(interaction.user.id, -bet, "crash_loss", `Crash loss at ${formatMultiplier(crashPoint)}`, isDemo);
        const newBal = isDemo ? updated.demoBalance : updated.balance;
        const gameId = await saveGameRecord({ userId: interaction.user.id, gameType: "crash", fair, bet, payout: -bet, resultData: { crashPoint, won: false }, isDemo });
        const embed = buildEmbed(interaction.user.username, bet, crashPoint, crashPoint, isDemo, "crashed")
          .addFields({ name: "New Balance", value: formatRobux(newBal) + ` ${label}`, inline: true })
          .setFooter({ text: `Game ID: ${gameId} • /verify ${gameId}` });
        await message.edit({ embeds: [embed], components: [disabledRow] });
      }
    };

    collector.on("collect", async (btn: ButtonInteraction) => {
      if (!active) return;
      await btn.deferUpdate().catch(() => {});
      const elapsed = (Date.now() - startTime) / 1000;
      const cashoutMultiplier = getMultiplierAt(elapsed);
      if (cashoutMultiplier >= crashPoint) {
        await endGame(false);
      } else {
        await endGame(true, cashoutMultiplier);
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason !== "time") return;
      await endGame(false);
    });

    const ticker = setInterval(async () => {
      if (!active) { clearInterval(ticker); return; }
      const elapsed = (Date.now() - startTime) / 1000;
      const current = getMultiplierAt(elapsed);

      if (current >= crashPoint) {
        clearInterval(ticker);
        await endGame(false);
        return;
      }

      const embed = buildEmbed(interaction.user.username, bet, current, crashPoint, isDemo, "live");
      await message.edit({ embeds: [embed], components: [cashOutRow] }).catch(() => {
        clearInterval(ticker);
        active = false;
        activeGames.delete(interaction.user.id);
      });
    }, TICK_MS);
  } catch (err: any) {
    console.error("[Crash Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong. Please try again.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: 64 });
    } catch {}
  }
}
