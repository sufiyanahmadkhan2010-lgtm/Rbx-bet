import { ChatInputCommandInteraction, Message, PermissionFlagsBits } from "discord.js";

export const OWNER_ID = "1456636693095383119";

export function isOwnerById(userId: string): boolean {
  return userId === OWNER_ID;
}

export async function checkOwnerInteraction(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isOwnerById(interaction.user.id)) return true;
  const perms = interaction.member?.permissions;
  if (perms && (perms as any).has?.(PermissionFlagsBits.Administrator)) return true;
  const member = interaction.guild?.members.cache.get(interaction.user.id)
    ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  return member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
}

export async function checkOwnerMessage(message: Message): Promise<boolean> {
  if (isOwnerById(message.author.id)) return true;
  const member = message.guild?.members.cache.get(message.author.id)
    ?? await message.guild?.members.fetch(message.author.id).catch(() => null);
  return member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
}
