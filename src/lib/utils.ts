import type { ChatInputCommandSuccessPayload, Command, ContextMenuCommandSuccessPayload, MessageCommandSuccessPayload } from '@sapphire/framework';
import { container } from '@sapphire/framework';
import { send } from '@sapphire/plugin-editable-commands';
import { cyan } from 'colorette';
import { ChannelType, EmbedBuilder, type APIUser, type Guild, type Message, type User } from 'discord.js';
import { RandomLoadingMessage } from './constants';

/**
 * Picks a random item from an array
 * @param array The array to pick a random item from
 * @example
 * const randomEntry = pickRandom([1, 2, 3, 4]) // 1
 */
export function pickRandom<T>(array: readonly T[]): T {
	const { length } = array;
	return array[Math.floor(Math.random() * length)];
}

/**
 * Sends a loading message to the current channel
 * @param message The message data for which to send the loading message
 */
export function sendLoadingMessage(message: Message): Promise<typeof message> {
	return send(message, { embeds: [new EmbedBuilder().setDescription(pickRandom(RandomLoadingMessage)).setColor('#FF0000')] });
}

export function logSuccessCommand(payload: ContextMenuCommandSuccessPayload | ChatInputCommandSuccessPayload | MessageCommandSuccessPayload): void {
	let successLoggerData: ReturnType<typeof getSuccessLoggerData>;

	if ('interaction' in payload) {
		successLoggerData = getSuccessLoggerData(payload.interaction.guild, payload.interaction.user, payload.command);
	} else {
		successLoggerData = getSuccessLoggerData(payload.message.guild, payload.message.author, payload.command);
	}

	container.logger.debug(`${successLoggerData.shard} - ${successLoggerData.commandName} ${successLoggerData.author} ${successLoggerData.sentAt}`);
}

export function getSuccessLoggerData(guild: Guild | null, user: User, command: Command) {
	const shard = getShardInfo(guild?.shardId ?? 0);
	const commandName = getCommandInfo(command);
	const author = getAuthorInfo(user);
	const sentAt = getGuildInfo(guild);

	return { shard, commandName, author, sentAt };
}

function getShardInfo(id: number) {
	return `[${cyan(id.toString())}]`;
}

function getCommandInfo(command: Command) {
	return cyan(command.name);
}

function getAuthorInfo(author: User | APIUser) {
	return `${author.username}[${cyan(author.id)}]`;
}

function getGuildInfo(guild: Guild | null) {
	if (guild === null) return 'Direct Messages';
	return `${guild.name}[${cyan(guild.id)}]`;
}

/**
 * Gets the start and end of the week for a given date.
 * @param week The week number (1-52)
 * @param year The year (e.g., 2025)
 */
export function getWeekRange(week: number, year: number): { start: Date; end: Date } {
	const startOfWeek = new Date(year, 0, 1 + (week - 1) * 7);
	const endOfWeek = new Date(year, 0, 1 + week * 7 - 1);

	// Adjust to the correct day of the week (ISO week starts on Monday)
	const startDay = startOfWeek.getDay() === 0 ? 6 : startOfWeek.getDay() - 1;
	const endDay = endOfWeek.getDay() === 0 ? 6 : endOfWeek.getDay() - 1;

	startOfWeek.setDate(startOfWeek.getDate() - startDay);
	endOfWeek.setDate(endOfWeek.getDate() + (6 - endDay));

	return { start: startOfWeek, end: endOfWeek };
}

export async function getGuild(guildId: string): Promise<Guild | null> {
	try {
		const guild = await container.client.guilds.fetch(guildId);
		return guild;
	} catch (error) {
		container.logger.error(`Failed to fetch guild with ID ${guildId}:`, error);
		return null;
	}
}

export async function getChannelsInCategory(guild: Guild, categoryId: string): Promise<string[]> {
	await guild.channels.fetch();
	const category = guild.channels.cache.get(categoryId);
	if (!category || category.type !== ChannelType.GuildCategory) return [];

	const channels = category.children.cache;
	return channels
		.filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildVoice)
		.map((channel) => channel.id);
}

export function extractUsername(reason: string): string | null {
	// Handles patterns like: [Tag] dd.mm.yyyy — HH:MM @username (Permanent):
	const m = reason.match(/@([A-Za-z0-9._-]{1,32})(?=\s*\()/);
	return m ? m[1] : null;
}

export function convertMiliToSeconds(ms: number): number {
	return Math.floor(ms / 1000);
}
