import { prisma } from '../../_core/lib/prisma';
import { container } from '@sapphire/framework';
import { Message, Snowflake, TextBasedChannel } from 'discord.js';
import { parseModerationEmbed, type ParsedCaseAction } from '../lib/parsers/caseParser';
import { parseModmailEmbed, type ParsedModmailClosure } from '../lib/parsers/modmailParser';
import { getGuild } from '../lib/utils';
import { envParseString } from '@skyra/env-utilities';

export async function upsertModAction(data: ParsedCaseAction, messageId: string, channelId: string) {
	let moderatorId: string | null = null;

	if (data.performedByUsername) {
		const user = await prisma.user.findFirst({
			where: { username: data.performedByUsername },
			include: { moderatorProfile: true }
		});

		if (user?.moderatorProfile) {
			moderatorId = user.moderatorProfile.id;
		}
	}

	return await prisma.modAction.upsert({
		where: { messageId },
		update: {
			action: data.action,
			caseId: data.caseId,
			performedAt: data.performedAt,
			performedByUsername: data.performedByUsername,
			moderatorId
		},
		create: {
			messageId,
			channelId,
			action: data.action,
			caseId: data.caseId,
			performedAt: data.performedAt,
			performedByUsername: data.performedByUsername,
			moderatorId
		}
	});
}

export async function upsertModmailClosure(data: ParsedModmailClosure, messageId: string, channelId: string, guildId: string) {
	let approved = false;
	if (data.closedById) {
		try {
			const guild = await getGuild(guildId);
			await guild.members.fetch(data.closedById);
			approved = true;
		} catch {
			approved = false;
		}
	}

	return await prisma.modmailThreadClosure.upsert({
		where: { messageId },
		update: {
			userId: data.userId,
			closedByUserId: data.closedById || 'UNKNOWN', // Schema requires string
			closedAt: data.closedAt,
			approved
		},
		create: {
			guildId,
			channelId,
			messageId,
			threadId: messageId, // Fallback
			userId: data.userId,
			closedByUserId: data.closedById || 'UNKNOWN',
			closedAt: data.closedAt,
			approved
		}
	});
}

export async function getLatestModmailClosure() {
	return await prisma.modmailThreadClosure.findFirst({
		orderBy: { closedAt: 'desc' }
	});
}

export async function checkModmailClosureExists(messageId: string) {
	const count = await prisma.modmailThreadClosure.count({
		where: { messageId }
	});
	return count > 0;
}

export async function getLatestModAction() {
	return await prisma.modAction.findFirst({
		orderBy: { performedAt: 'desc' }
	});
}

export async function checkModActionExists(messageId: string) {
	const count = await prisma.modAction.count({
		where: { messageId }
	});
	return count > 0;
}

/**
 * Generic function to catch up on messages in a channel.
 * @param channel The channel to sync messages from.
 * @param getLatestProcessed Function to get the ID of the last processed message.
 * @param processMessage Function to process each message. Returns true if the message was already processed or should be skipped (adds to "streak"), false if it was a new valid entry.
 * @param typeName Name of the data type being synced (for logging).
 */
async function catchupMessages(
	channel: TextBasedChannel,
	getLatestProcessed: () => Promise<{ messageId: string } | null>,
	processMessage: (message: Message) => Promise<boolean>,
	typeName: string
) {
	const latestProcessed = await getLatestProcessed();
	const latestMessage = await channel.messages.fetch({ limit: 1 }).then((msgs) => msgs.first());

	if (latestProcessed?.messageId === latestMessage?.id) {
		container.logger.info(`[Stardust] No new ${typeName} to sync.`);
		return;
	}

	let before: Snowflake | undefined = undefined;
	let processedCount = 0;
	let alreadyHadStreak = 0;
	const MAX_CONSECUTIVE_ALREADY = 50;
	const MAX_MESSAGES = 5000;

	container.logger.info(`[Stardust] Starting ${typeName} catch-up...`);

	while (processedCount < MAX_MESSAGES) {
		const batch: ReturnType<typeof channel.messages.fetch> extends Promise<infer R> ? R : any = await channel.messages
			.fetch({ limit: 100, before })
			.catch(() => null as any);

		if (!batch || batch.size === 0) break;

		for (const msg of batch.values()) {
			const alreadyProcessed = await processMessage(msg);

			if (alreadyProcessed) {
				alreadyHadStreak++;
				if (alreadyHadStreak >= MAX_CONSECUTIVE_ALREADY) {
					container.logger.info(`[Stardust] Reached already stored ${typeName} streak; stopping.`);
					return;
				}
			} else {
				alreadyHadStreak = 0;
			}
		}

		processedCount += batch.size;
		before = batch.lastKey();

		await new Promise((resolve) => setTimeout(resolve, 500));
		if (!before) break;
	}

	container.logger.info(`[Stardust] Processed ${processedCount} ${typeName} messages.`);
}

export async function syncModActions(channel?: TextBasedChannel) {
	if (!channel) {
		const serverID = envParseString('MainServer_ID');
		const channelID = envParseString('MainServer_ModCasesChannelID');
		const guild = await container.client.guilds.fetch(serverID);
		const fetchedChannel = await guild.channels.fetch(channelID);
		if (!fetchedChannel?.isTextBased()) return;
		channel = fetchedChannel as TextBasedChannel;
	}

	await catchupMessages(channel, getLatestModAction, upsertModActionFromMessage, 'mod actions');
}

export async function syncModmail(channel?: TextBasedChannel) {
	if (!channel) {
		const serverID = envParseString('MainServer_ID');
		const channelID = envParseString('MainServer_ModMailChannelID');
		const guild = await container.client.guilds.fetch(serverID);
		const fetchedChannel = await guild.channels.fetch(channelID);
		if (!fetchedChannel?.isTextBased()) return;
		channel = fetchedChannel as TextBasedChannel;
	}

	await catchupMessages(channel, getLatestModmailClosure, upsertModmailFromMessage, 'modmail closures');
}

async function upsertModActionFromMessage(message: Message) {
	if (!message.embeds.length) return true;

	const exists = await checkModActionExists(message.id);
	if (exists) return true;

	const embed = message.embeds[0];
	const parsed = parseModerationEmbed(embed);

	if (!parsed) return true;

	const entry = await upsertModAction(parsed, message.id, message.channelId);

	if (!entry.moderatorId) container.tasks.create({ name: 'attemptFetchID', payload: { modActionDatabaseID: entry.id } });
	return false;
}

async function upsertModmailFromMessage(message: Message) {
	if (!message.embeds.length) return true;

	const exists = await checkModmailClosureExists(message.id);
	if (exists) return true;

	const embed = message.embeds[0];
	const parsed = parseModmailEmbed(embed);

	if (!parsed) return true;

	await upsertModmailClosure(parsed, message.id, message.channelId, message.guildId!);
	return false;
}
