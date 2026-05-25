import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ComponentType, ButtonInteraction,
} from "discord.js";
import { getOrCreateUser, updateBalance, applyAffiliateBonus } from "../utils/db";
import { errorEmbed, formatRobux, BOT_COLOR, WIN_COLOR, LOSE_COLOR } from "../utils/embed";
import {
  GRID_SIZE, MinesGame, activeGames,
  generateMinePositions, calculateMultiplier, nextMultiplier,
} from "../games/mines";
import { getFairContext, saveGameRecord } from "../utils/provably-fair";
import { isHoneypotActive } from "../utils/honeypot";
import { checkDemoExpiry, incrementCounts } from "../utils/gameUtils";

export const data = new SlashCommandBuilder()
  .setName("mines")
  .setDescription("Reveal safe tiles and cash out before hitting a mine!")
  .addIntegerOption(opt =>
    opt.setName("bet").setDescription("Amount to bet").setRequired(true).setMinValue(1)
  )
  .addIntegerOption(opt =>
    opt.setName("mines").setDescription("Number of mines (1–15)").setRequired(true).setMinValue(1).setMaxValue(15)
  )
  .addBooleanOption(opt =>
    opt.setName("demo").setDescription("Use demo balance?").setRequired(false)
  );

const TILE_EMOJIS = { hidden: "🔲", safe: "💎", mine: "💣", cashout: "💸" };

function buildGrid(game: MinesGame, revealAll = false): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let row = 0; row < 4; row++) {
    const actionRow = new ActionRowBuilder<ButtonBuilder>();
    for (let col = 0; col < 5; col++) {
      const idx = row * 5 + col;
      const isRevealed = game.revealed.has(idx);
      const isMine = game.minePositions.has(idx);
      const btn = new ButtonBuilder().setCustomId(`mines_tile_${idx}_${game.userId}`);

      if (isRevealed || (revealAll && isMine)) {
        if (isMine) {
          btn.setLabel(TILE_EMOJIS.mine).setStyle(ButtonStyle.Danger).setDisabled(true);
        } else {
          btn.setLabel(TILE_EMOJIS.safe).setStyle(ButtonStyle.Success).setDisabled(true);
        }
      } else if (revealAll && !isMine && !isRevealed) {
        btn.setLabel(TILE_EMOJIS.safe).setStyle(ButtonStyle.Success).setDisabled(true);
      } else {
        btn.setLabel(TILE_EMOJIS.hidden).setStyle(ButtonStyle.Secondary).setDisabled(!game.active);
      }
      actionRow.addComponents(btn);
    }
    rows.push(actionRow);
  }

  // Cash Out row
  const cashOutRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mines_cashout_${game.userId}`)
      .setLabel(game.revealed.size === 0 ? "🔲 Reveal a tile first" : `💸 Cash Out — ${calculateMultiplier(GRID_SIZE, game.mines, game.revealed.size).toFixed(2)}x`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!game.active || game.revealed.size === 0),
  );
  rows.push(cashOutRow);
  return rows;
}

function buildEmbed(game: MinesGame, label: string, status: "active" | "won" | "lost", payout?: number) {
  const revealed = game.revealed.size;
  const safeLeft = GRID_SIZE - game.mines - revealed;
  const currentMult = calculateMultiplier(GRID_SIZE, game.mines, revealed);
  const nextMult = nextMultiplier(GRID_SIZE, game.mines, revealed);
  const currentWin = Math.floor(game.bet * currentMult);
  const profit = currentWin - game.bet;

  if (status === "active") {
    return new EmbedBuilder()
      .setTitle(`💣 Mines — ${game.mines} mines on ${GRID_SIZE} tiles`)
      .setColor(BOT_COLOR)
      .addFields(
        { name: "Bet", value: formatRobux(game.bet), inline: true },
        { name: "Revealed", value: `${revealed} safe`, inline: true },
        { name: "Current Multiplier", value: `${currentMult.toFixed(2)}x`, inline: true },
        { name: "Cash Out Now", value: formatRobux(currentWin), inline: true },
        { name: "Next Tile Pays", value: `${nextMult.toFixed(2)}x → ${formatRobux(Math.floor(game.bet * nextMult))}`, inline: true },
        { name: "Safe Tiles Left", value: `${safeLeft}`, inline: true },
      )
      .setFooter({ text: `${game.isDemo ? "🎮 Demo • " : ""}Click tiles to reveal. Cash out anytime!` });
  }

  if (status === "won") {
    const p = profit >= 0 ? `+${formatRobux(profit)}` : formatRobux(profit);
    return new EmbedBuilder()
      .setTitle(`💰 Cashed Out at ${currentMult.toFixed(2)}x!`)
      .setColor(WIN_COLOR)
      .setDescription(`Won **${formatRobux(payout ?? currentWin)}** ${label}! (${p})`)
      .addFields(
        { name: "Tiles Revealed", value: `${revealed}`, inline: true },
        { name: "Mines", value: `${game.mines}`, inline: true },
        { name: "Multiplier", value: `${currentMult.toFixed(2)}x`, inline: true },
      )
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setTitle("💥 BOOM! Mine Hit!")
    .setColor(LOSE_COLOR)
    .setDescription(`You hit a mine and lost **${formatRobux(game.bet)}** ${label}!`)
    .addFields(
      { name: "Tiles Revealed", value: `${revealed} safe before explosion`, inline: true },
      { name: "Mines", value: `${game.mines}`, inline: true },
    )
    .setTimestamp();
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const bet = interaction.options.getInteger("bet", true);
  const mineCount = interaction.options.getInteger("mines", true);
  const isDemo = interaction.options.getBoolean("demo") ?? false;
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (isDemo) { if (await checkDemoExpiry(user, interaction)) return; }

  const balance = isDemo ? user.demoBalance : user.balance;
  const label = isDemo ? "Demo Robux" : "Robux";
  if (balance < bet) {
    await interaction.reply({ embeds: [errorEmbed(`Not enough ${label}! Balance: ${formatRobux(balance)}`)], ephemeral: true });
    return;
  }
  if (activeGames.has(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed("You already have an active mines game!")], ephemeral: true });
    return;
  }

  const fair = await getFairContext(interaction.user.id);
  const honeypot = !isDemo && isHoneypotActive(user.gameCount);

  // Honeypot: place mines away from likely first clicks (corners/edges)
  const minePositions = generateMinePositions(fair.serverSeed, fair.nonce, honeypot ? Math.max(1, mineCount - 1) : mineCount);

  const game: MinesGame = {
    userId: interaction.user.id,
    bet,
    mines: mineCount,
    minePositions,
    revealed: new Set(),
    isDemo,
    cashoutMultiplier: 1,
    active: true,
  };
  activeGames.set(interaction.user.id, game);

  const embed = buildEmbed(game, label, "active");
  const components = buildGrid(game);
  const reply = await interaction.reply({ embeds: [embed], components, withResponse: true });
  const message = reply.resource?.message;
  if (!message) { activeGames.delete(interaction.user.id); return; }

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === interaction.user.id,
    time: 5 * 60 * 1000,
  });

  const endGame = async (won: boolean, btn?: ButtonInteraction) => {
    if (!game.active) return;
    game.active = false;
    activeGames.delete(interaction.user.id);
    collector.stop();
    await incrementCounts(interaction.user.id, isDemo);

    const revealAll = !won;
    const components = buildGrid(game, revealAll);

    if (won) {
      const mult = calculateMultiplier(GRID_SIZE, game.mines, game.revealed.size);
      const payout = Math.floor(game.bet * mult);
      const profit = payout - game.bet;
      const updated = await updateBalance(interaction.user.id, profit, "mines_win", `Mines cashout at ${mult.toFixed(2)}x`, isDemo);
      if (!isDemo && profit > 0) await applyAffiliateBonus(interaction.user.id, profit);
      const newBal = isDemo ? updated.demoBalance : updated.balance;
      const gameId = await saveGameRecord({ userId: interaction.user.id, gameType: "mines", fair, bet, payout: profit, resultData: { mines: mineCount, revealed: game.revealed.size, mult, won: true }, isDemo });
      const embed = buildEmbed(game, label, "won", payout)
        .addFields({ name: "New Balance", value: formatRobux(newBal) + ` ${label}`, inline: true })
        .setFooter({ text: `Game ID: ${gameId} • /verify ${gameId}` });
      if (btn) await btn.update({ embeds: [embed], components });
      else await message.edit({ embeds: [embed], components });
    } else {
      const updated = await updateBalance(interaction.user.id, -bet, "mines_loss", `Mines loss (${mineCount} mines)`, isDemo);
      const newBal = isDemo ? updated.demoBalance : updated.balance;
      const gameId = await saveGameRecord({ userId: interaction.user.id, gameType: "mines", fair, bet, payout: -bet, resultData: { mines: mineCount, revealed: game.revealed.size, won: false }, isDemo });
      const embed = buildEmbed(game, label, "lost")
        .addFields({ name: "New Balance", value: formatRobux(newBal) + ` ${label}`, inline: true })
        .setFooter({ text: `Game ID: ${gameId} • /verify ${gameId}` });
      if (btn) await btn.update({ embeds: [embed], components });
      else await message.edit({ embeds: [embed], components });
    }
  };

  collector.on("collect", async (btn: ButtonInteraction) => {
    if (!game.active) return;

    if (btn.customId === `mines_cashout_${interaction.user.id}`) {
      await endGame(true, btn);
      return;
    }

    const tileMatch = btn.customId.match(/^mines_tile_(\d+)_/);
    if (!tileMatch) return;
    const tileIdx = parseInt(tileMatch[1]);

    if (game.revealed.has(tileIdx)) return;

    if (game.minePositions.has(tileIdx)) {
      // Hit a mine
      game.revealed.add(tileIdx);
      await endGame(false, btn);
    } else {
      // Safe tile
      game.revealed.add(tileIdx);
      const safeLeft = GRID_SIZE - game.mines - game.revealed.size;

      // Auto cash out if all safe tiles revealed
      if (safeLeft === 0) {
        await endGame(true, btn);
        return;
      }

      const updatedEmbed = buildEmbed(game, label, "active");
      const updatedComponents = buildGrid(game);
      await btn.update({ embeds: [updatedEmbed], components: updatedComponents });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time" && game.active) {
      await endGame(false);
    }
  });
}
