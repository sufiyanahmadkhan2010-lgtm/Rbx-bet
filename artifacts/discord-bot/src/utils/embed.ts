import { EmbedBuilder, ColorResolvable } from "discord.js";

export const ROBUX_EMOJI = "🟢";
export const BOT_COLOR: ColorResolvable = 0x00b4d8;
export const WIN_COLOR: ColorResolvable = 0x2ecc71;
export const LOSE_COLOR: ColorResolvable = 0xe74c3c;

export function formatRobux(amount: number): string {
  return `${ROBUX_EMOJI} **${amount.toLocaleString()} Robux**`;
}

export function baseEmbed(title: string, color: ColorResolvable = BOT_COLOR): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp();
}

export function winEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🎉 ${title}`)
    .setDescription(description)
    .setColor(WIN_COLOR)
    .setTimestamp();
}

export function loseEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`💸 ${title}`)
    .setDescription(description)
    .setColor(LOSE_COLOR)
    .setTimestamp();
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("❌ Error")
    .setDescription(description)
    .setColor(0xff0000);
}
