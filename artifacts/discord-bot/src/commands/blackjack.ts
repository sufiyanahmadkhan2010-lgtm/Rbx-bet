import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction } from "discord.js";
import { getOrCreateUser, updateBalance, applyAffiliateBonus } from "../utils/db";
import { winEmbed, loseEmbed, errorEmbed, formatRobux, baseEmbed } from "../utils/embed";
import { dealGame, playerHit, dealerPlay, handValue, formatHand, activeGames, BlackjackOutcome } from "../games/blackjack";
import { getFairContext, saveGameRecord, FairContext } from "../utils/provably-fair";
import { isHoneypotActive, honeypotRolls } from "../utils/honeypot";
import { checkDemoExpiry, incrementCounts } from "../utils/gameUtils";

const HOUSE_EDGE = 0.96;

export const data = new SlashCommandBuilder()
  .setName("blackjack")
  .setDescription("Play blackjack against the dealer!")
  .addIntegerOption(opt => opt.setName("bet").setDescription("Amount to bet").setRequired(true).setMinValue(1))
  .addBooleanOption(opt => opt.setName("demo").setDescription("Use demo balance?").setRequired(false));

function gameEmbed(playerHand: string, playerTotal: number, dealerVisible: string, showFull: boolean, dealerTotal?: number, isDemo = false) {
  return baseEmbed(`🃏 Blackjack${isDemo ? " 🎮 Demo" : ""}`)
    .addFields(
      { name: "Your Hand", value: `${playerHand} (${playerTotal})`, inline: true },
      { name: "Dealer's Hand", value: showFull ? `${dealerVisible} (${dealerTotal})` : `${dealerVisible} [?]`, inline: true },
    );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const bet = interaction.options.getInteger("bet", true);
  const isDemo = interaction.options.getBoolean("demo") ?? false;
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (isDemo) { if (await checkDemoExpiry(user, interaction)) return; }

  const balance = isDemo ? user.demoBalance : user.balance;
  const label = isDemo ? "Demo Robux" : "Robux";
  if (balance < bet) {
    await interaction.reply({ embeds: [errorEmbed(`Not enough ${label}!`)], ephemeral: true });
    return;
  }
  if (activeGames.has(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed("You already have an active blackjack game!")], ephemeral: true });
    return;
  }

  const fair = await getFairContext(interaction.user.id);
  const honeypot = !isDemo && isHoneypotActive(user.gameCount);
  const rolls = honeypot ? honeypotRolls(fair.rolls, user.gameCount) : fair.rolls;
  const game = dealGame(interaction.user.id, bet, rolls, isDemo, honeypot);
  const playerTotal = handValue(game.playerHand);
  const dealerFirst = game.dealerHand[0];

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("bj_hit").setLabel("Hit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("bj_stand").setLabel("Stand").setStyle(ButtonStyle.Secondary),
  );

  const embed = gameEmbed(formatHand(game.playerHand), playerTotal, `${dealerFirst.value}${dealerFirst.suit}`, false, undefined, isDemo);
  const reply = await interaction.reply({ embeds: [embed], components: [row], withResponse: true });
  const message = reply.resource?.message;

  if (playerTotal === 21) {
    await finishGame(interaction, game, "blackjack", bet, isDemo, label, fair);
    return;
  }

  if (!message) return;
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000, filter: i => i.user.id === interaction.user.id });

  collector.on("collect", async (btn: ButtonInteraction) => {
    await btn.deferUpdate();
    if (btn.customId === "bj_hit") {
      playerHit(game);
      const newTotal = handValue(game.playerHand);
      if (newTotal > 21) {
        collector.stop("bust");
        await finishGame(interaction, game, "player_bust", bet, isDemo, label, fair);
      } else if (newTotal === 21) {
        collector.stop("21");
        const outcome = dealerPlay(game);
        await finishGame(interaction, game, outcome, bet, isDemo, label, fair);
      } else {
        await interaction.editReply({ embeds: [gameEmbed(formatHand(game.playerHand), newTotal, `${dealerFirst.value}${dealerFirst.suit}`, false, undefined, isDemo)], components: [row] });
      }
    } else {
      collector.stop("stand");
      await finishGame(interaction, game, dealerPlay(game), bet, isDemo, label, fair);
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") {
      activeGames.delete(interaction.user.id);
      const updated = await updateBalance(interaction.user.id, -bet, "blackjack_timeout", "Blackjack timeout", isDemo);
      await incrementCounts(interaction.user.id, isDemo);
      const newBal = isDemo ? updated.demoBalance : updated.balance;
      await interaction.editReply({ embeds: [loseEmbed("Time's up!", `Lost ${formatRobux(bet)} ${label}.\nBalance: ${formatRobux(newBal)} ${label}`)], components: [] });
    }
  });
}

async function finishGame(interaction: ChatInputCommandInteraction, game: ReturnType<typeof dealGame>, outcome: BlackjackOutcome, bet: number, isDemo: boolean, label: string, fair: FairContext) {
  activeGames.delete(game.userId);
  await incrementCounts(game.userId, isDemo);
  const playerTotal = handValue(game.playerHand);
  const dealerTotal = handValue(game.dealerHand);
  const fields = gameEmbed(formatHand(game.playerHand), playerTotal, formatHand(game.dealerHand), true, dealerTotal, isDemo).data.fields ?? [];

  async function settle(payout: number, title: string, desc: (bal: number, gameId: number) => string, isWin: boolean) {
    const updated = await updateBalance(game.userId, payout, "blackjack", `Blackjack ${isWin ? "win" : "loss"}`, isDemo);
    if (isWin && !isDemo) await applyAffiliateBonus(game.userId, payout);
    const newBal = isDemo ? updated.demoBalance : updated.balance;
    const gameId = await saveGameRecord({ userId: game.userId, gameType: "blackjack", fair, bet, payout, resultData: { outcome, playerTotal, dealerTotal }, isDemo });
    const embed = isWin ? winEmbed(title, desc(newBal, gameId)) : loseEmbed(title, desc(newBal, gameId));
    await interaction.editReply({ embeds: [embed.addFields(fields)], components: [] });
  }

  if (outcome === "blackjack") {
    const p = Math.floor(bet * 1.5 * HOUSE_EDGE);
    await settle(p, "♠ Blackjack!", (b, id) => `Natural 21! Won ${formatRobux(p)} ${label}!\nBalance: ${formatRobux(b)} ${label}\n\`Game ID: ${id}\``, true);
  } else if (outcome === "player_bust") {
    await settle(-bet, "Bust!", (b, id) => `Over 21! Lost ${formatRobux(bet)} ${label}.\nBalance: ${formatRobux(b)} ${label}\n\`Game ID: ${id}\``, false);
  } else if (outcome === "dealer_bust" || outcome === "player_win") {
    const p = Math.floor(bet * HOUSE_EDGE);
    await settle(p, "You Win!", (b, id) => `${outcome === "dealer_bust" ? "Dealer busted! " : ""}Won ${formatRobux(p)} ${label}!\nBalance: ${formatRobux(b)} ${label}\n\`Game ID: ${id}\``, true);
  } else if (outcome === "dealer_win") {
    await settle(-bet, "Dealer Wins", (b, id) => `Lost ${formatRobux(bet)} ${label}.\nBalance: ${formatRobux(b)} ${label}\n\`Game ID: ${id}\``, false);
  } else {
    const gameId = await saveGameRecord({ userId: game.userId, gameType: "blackjack", fair, bet, payout: 0, resultData: { outcome, playerTotal, dealerTotal }, isDemo });
    await interaction.editReply({ embeds: [gameEmbed(formatHand(game.playerHand), playerTotal, formatHand(game.dealerHand), true, dealerTotal, isDemo).setTitle("🤝 Push!").setDescription(`Tie — ${formatRobux(bet)} ${label} returned.\n\`Game ID: ${gameId}\``)], components: [] });
  }
}
