// Stardust Service Layer
// Handles all interactions related to fetching and computing stardust data

import { prisma } from '../../_core/lib/prisma';
import { getDateFromWeekNumber, getWeekRange, getGuild, getChannelsInCategory, getISOWeekNumber } from '../lib/utils';
import { computeWeightedPoints } from '../lib/points';
import { envParseString } from '@skyra/env-utilities';
import * as StarStatBot from './startrack.service';
import { MonthlyStat, WeeklyStat } from '@prisma/client';
import { parseModerationEmbed, type ParsedCaseAction } from '../lib/parsers/caseParser';
import { parseModmailEmbed, type ParsedModmailClosure } from '../lib/parsers/modmailParser';
import { container } from '@sapphire/framework';
import { Message, Snowflake, TextBasedChannel } from 'discord.js';

export async function ensureUser(userId: string, username: string) {
	return await prisma.user.upsert({
		where: { id: userId },
		update: { username },
		create: { id: userId, username }
	});
}

export async function getUser(userId: string) {
	return await prisma.user.findUniqueOrThrow({
		where: { id: userId }
	});
}

export async function activateEnrollment(userId: string) {
	const profile = await prisma.moderatorProfile.findUnique({ where: { userId } });

	if (profile?.active) throw new Error('Enrollment is already active.');

	await prisma.moderatorProfile.upsert({
		where: { userId },
		update: { active: true, enrolledAt: new Date() },
		create: { userId, active: true, enrolledAt: new Date() }
	});

	return;
}

export async function deactivateEnrollment(userId: string) {
	const profile = await prisma.moderatorProfile.findUniqueOrThrow({ where: { userId } });
	if (!profile.active) throw new Error('Enrollment is already inactive.');

	await prisma.moderatorProfile.update({
		where: { userId },
		data: { active: false }
	});

	return;
}

export async function getModeratorsList() {
	return await prisma.moderatorProfile.findMany({
		where: { active: true },
		include: { user: true }
	});
}

export async function fetchModActions(memberId: string, week: number, year: number) {
	const { startWeek, endWeek } = await getWeekRange(week, year);
	const start = getDateFromWeekNumber(startWeek, year, 'start');
	const end = getDateFromWeekNumber(endWeek, year, 'end');

	return await prisma.modAction.count({
		where: {
			moderator: { userId: memberId },
			performedAt: { gte: start, lte: end },
			action: { in: ['BAN', 'WARN', 'MUTE', 'KICK'] }
		}
	});
}

export async function fetchModmailCases(memberId: string, week: number, year: number) {
	const { startWeek, endWeek } = await getWeekRange(week, year);
	const start = getDateFromWeekNumber(startWeek, year, 'start');
	const end = getDateFromWeekNumber(endWeek, year, 'end');

	return await prisma.modmailThreadClosure.count({
		where: {
			closedByUserId: memberId,
			approved: true,
			closedAt: { gte: start, lte: end }
		}
	});
}

export async function getModeratorProfile(userId: string) {
	return await prisma.moderatorProfile.findUniqueOrThrow({
		where: { userId },
		include: { user: true, weeklyStats: true, modActions: true }
	});
}

export async function getCurrentMonthPoints(userId: string, month: number, year: number) {
	const stats = await getMonthRecords(userId, month, year);

	const points = await Promise.all(stats.map((stat) => computeWeeklyPointsAndUpdate(stat)));

	const rawPoints = points.reduce((acc, point) => acc + point.totalPoints, 0);
	const finalPoints = points.reduce((acc, point) => acc + point.rawPoints, 0);
	const wastedPoints = rawPoints - finalPoints;

	return { rawPoints, finalPoints, wastedPoints };
}

async function computeWeeklyPointsAndUpdate(weeklyStat: WeeklyStat) {
	const points = computeWeightedPoints({
		modChatMessages: weeklyStat.modChatMessages,
		publicChatMessages: weeklyStat.publicChatMessages,
		voiceChatMinutes: weeklyStat.voiceChatMinutes,
		modActionsTaken: weeklyStat.modActionsCount,
		casesHandled: weeklyStat.casesHandledCount
	});

	return await prisma.weeklyStat.update({
		where: {
			moderatorId_year_week: {
				moderatorId: weeklyStat.moderatorId,
				year: weeklyStat.year,
				week: weeklyStat.week
			}
		},
		data: {
			rawPoints: points.totalRawPoints,
			totalPoints: points.totalFinalizedPoints,
			updatedAt: new Date()
		},
		include: { moderator: { include: { user: true } } }
	});
}

export async function getWeeklyRecords(userId: string, week: number, year: number) {
	const profile = await prisma.moderatorProfile.findUniqueOrThrow({ where: { userId } });

	// Compute points first
	let stat = await prisma.weeklyStat.findUniqueOrThrow({
		where: {
			moderatorId_year_week: {
				moderatorId: profile.id,
				year,
				week
			}
		},
		include: { moderator: { include: { user: true } } }
	});

	return await computeWeeklyPointsAndUpdate(stat);
}

export async function getMonthRecords(userId: string, month: number, year: number) {
	const { startWeek, endWeek } = await getWeekRange(month, year);

	const stats = await prisma.weeklyStat.findMany({
		where: {
			moderatorId: userId,
			year,
			week: {
				gte: startWeek,
				lte: endWeek
			}
		},
		include: { moderator: { include: { user: true } } }
	});

	return stats;
}

export async function getMonthlyReport(month: number, year: number) {
	let stats = await prisma.monthlyStat.findMany({
		where: {
			month,
			year
		},
		include: { moderator: { include: { user: true } } }
	});

	// If we don't have a report, check if month has passed yet
	if (stats.length === 0) {
		const now = new Date();
		if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
			throw new Error('Cannot generate report for a future month.');
		}

		const { startWeek, endWeek } = await getWeekRange(month, year);

		const weeklyStats = await prisma.weeklyStat.findMany({
			where: {
				year,
				week: {
					gte: startWeek,
					lte: endWeek
				}
			},
			include: { moderator: { include: { user: true } } }
		});

		const aggregatedStats = new Map<string, any>();

		for (const stat of weeklyStats) {
			if (!aggregatedStats.has(stat.moderatorId)) {
				aggregatedStats.set(stat.moderatorId, {
					moderatorId: stat.moderatorId,
					moderator: stat.moderator,
					year,
					month,
					modChatMessages: 0,
					publicChatMessages: 0,
					voiceChatMinutes: 0,
					modActionsCount: 0,
					casesHandledCount: 0,
					totalPoints: 0,
					rawPoints: 0
				});
			}

			const entry = aggregatedStats.get(stat.moderatorId);
			entry.modChatMessages += stat.modChatMessages;
			entry.publicChatMessages += stat.publicChatMessages;
			entry.voiceChatMinutes += stat.voiceChatMinutes;
			entry.modActionsCount += stat.modActionsCount;
			entry.casesHandledCount += stat.casesHandledCount;
			entry.totalPoints += stat.totalPoints;
			entry.rawPoints += stat.rawPoints;
		}

		stats = Array.from(aggregatedStats.values());

		const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);

		if (isPastMonth && stats.length > 0) {
			await prisma.$transaction(
				stats.map((stat) =>
					prisma.monthlyStat.create({
						data: {
							moderatorId: stat.moderatorId,
							year,
							month,
							modChatMessages: stat.modChatMessages,
							publicChatMessages: stat.publicChatMessages,
							voiceChatMinutes: stat.voiceChatMinutes,
							modActionsCount: stat.modActionsCount,
							casesHandledCount: stat.casesHandledCount,
							totalPoints: stat.totalPoints,
							rawPoints: stat.rawPoints
						}
					})
				)
			);

			stats = await prisma.monthlyStat.findMany({
				where: {
					month,
					year
				},
				include: { moderator: { include: { user: true } } }
			});
		}
	}

	// Compile report data
	const totalStats = calculateTotalStats(stats);

	return { stats, totalStats };
}

function calculateTotalStats(stats: MonthlyStat[] | WeeklyStat[]) {
	return stats.reduce(
		(acc, stat) => {
			acc.rawPoints += stat.rawPoints;
			acc.finalPoints += stat.totalPoints;
			acc.wastedPoints += stat.rawPoints - stat.totalPoints;

			acc.modChatMessages += stat.modChatMessages;
			acc.publicChatMessages += stat.publicChatMessages;
			acc.voiceChatMinutes += stat.voiceChatMinutes;
			acc.modActionsCount += stat.modActionsCount;
			acc.casesHandledCount += stat.casesHandledCount;

			return acc;
		},
		{
			rawPoints: 0,
			finalPoints: 0,
			wastedPoints: 0,
			modChatMessages: 0,
			publicChatMessages: 0,
			voiceChatMinutes: 0,
			modActionsCount: 0,
			casesHandledCount: 0
		}
	);
}

export async function fetchAllMetrics(memberId: string, week: number, year: number) {
	const serverID = envParseString('MainServer_ID');
	const guild = await getGuild(serverID);
	const modChatChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModChatCategoryID'));
	const modCommandsChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModCommandsCategoryID'));

	const [modChatMessages, publicChatMessages, voiceChatMinutes, modActionsTaken, casesHandled] = await Promise.all([
		StarStatBot.fetchModChatMessageCount({ moderatorId: memberId, week, year, serverID, channelIds: modChatChannelIds }),
		StarStatBot.fetchPublicChatMessageCount({
			moderatorId: memberId,
			week,
			year,
			serverID,
			channelIds: [...modChatChannelIds, ...modCommandsChannelIds]
		}),
		StarStatBot.fetchVoiceMinutes({
			moderatorId: memberId,
			week,
			year,
			serverID,
			channelIds: [...modChatChannelIds, ...modCommandsChannelIds]
		}),
		fetchModActions(memberId, week, year),
		fetchModmailCases(memberId, week, year)
	]);

	return {
		modChatMessages,
		publicChatMessages,
		voiceChatMinutes,
		modActionsTaken,
		casesHandled
	};
}

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

export async function processWeeklyStats(week: number, year: number) {
	const moderators = await getModeratorsList();
	container.logger.info(`[Stardust] Processing weekly stats for Week ${week}, ${year} for ${moderators.length} moderators.`);

	for (const mod of moderators) {
		container.logger.debug(`[Stardust] Fetching metrics for ${mod.user.username} (${mod.userId})...`);
		const metrics = await fetchAllMetrics(mod.userId, week, year);
		container.logger.debug(`[Stardust] Metrics for ${mod.user.username}: ${JSON.stringify(metrics)}`);

		await prisma.weeklyStat.upsert({
			where: {
				moderatorId_year_week: {
					moderatorId: mod.id,
					year,
					week
				}
			},
			update: {
				modChatMessages: metrics.modChatMessages,
				publicChatMessages: metrics.publicChatMessages,
				voiceChatMinutes: metrics.voiceChatMinutes,
				modActionsCount: metrics.modActionsTaken,
				casesHandledCount: metrics.casesHandled,
				updatedAt: new Date()
			},
			create: {
				moderatorId: mod.id,
				year,
				week,
				modChatMessages: metrics.modChatMessages,
				publicChatMessages: metrics.publicChatMessages,
				voiceChatMinutes: metrics.voiceChatMinutes,
				modActionsCount: metrics.modActionsTaken,
				casesHandledCount: metrics.casesHandled,
				rawPoints: 0,
				totalPoints: 0
			}
		});

		const result = await getWeeklyRecords(mod.userId, week, year);
		container.logger.debug(`[Stardust] Points for ${mod.user.username}: Raw=${result.rawPoints}, Total=${result.totalPoints}`);
	}
	container.logger.info(`[Stardust] Completed weekly stats for Week ${week}, ${year}.`);
}

export async function syncModActions() {
	const serverID = envParseString('MainServer_ID');
	const channelID = envParseString('MainServer_ModCasesChannelID');
	const guild = await container.client.guilds.fetch(serverID);
	const channel = await guild.channels.fetch(channelID);

	if (!channel?.isTextBased()) return;

	await catchupOnCases(channel);
}

export async function syncModmail() {
	const serverID = envParseString('MainServer_ID');
	const channelID = envParseString('MainServer_ModMailChannelID');
	const guild = await container.client.guilds.fetch(serverID);
	const channel = await guild.channels.fetch(channelID);

	if (!channel?.isTextBased()) return;

	await catchupOnModmail(channel);
}

async function catchupOnCases(channel: TextBasedChannel) {
	const latestCase = await getLatestModAction();
	const latestMessage = await channel.messages.fetch({ limit: 1 }).then((msgs) => msgs.first());

	if (latestCase?.messageId === latestMessage?.id) {
		container.logger.info('[Stardust] No new mod actions');
		return;
	}

	let before: Snowflake | undefined = undefined;
	let processed = 0;
	let alreadyHadStreak = 0;
	const MAX_CONSECUTIVE_ALREADY = 50;
	const MAX_MESSAGES = 5000;

	while (processed < MAX_MESSAGES) {
		const batch: ReturnType<typeof channel.messages.fetch> extends Promise<infer R> ? R : any = await channel.messages
			.fetch({ limit: 100, before })
			.catch(() => null as any);

		if (!batch || batch.size === 0) break;

		for (const msg of batch.values()) {
			const had = await upsertModActionFromMessage(msg);

			if (had) {
				alreadyHadStreak++;
				if (alreadyHadStreak >= MAX_CONSECUTIVE_ALREADY) {
					container.logger.info('[Stardust] Reached already stored messages streak; stopping.');
					return;
				}
			} else {
				alreadyHadStreak = 0;
			}
		}

		processed += batch.size;
		before = batch.lastKey();

		await new Promise((resolve) => setTimeout(resolve, 500));
		if (!before) break;
	}

	container.logger.info(`[Stardust] Processed ${processed} messages`);
}

async function catchupOnModmail(channel: TextBasedChannel) {
	const latestClosure = await getLatestModmailClosure();
	const latestMessage = await channel.messages.fetch({ limit: 1 }).then((msgs) => msgs.first());

	if (latestClosure?.messageId === latestMessage?.id) {
		container.logger.info('[Stardust] No new modmail closures');
		return;
	}

	let before: Snowflake | undefined = undefined;
	let processed = 0;
	let alreadyHadStreak = 0;
	const MAX_CONSECUTIVE_ALREADY = 50;
	const MAX_MESSAGES = 5000;

	while (processed < MAX_MESSAGES) {
		const batch: ReturnType<typeof channel.messages.fetch> extends Promise<infer R> ? R : any = await channel.messages
			.fetch({ limit: 100, before })
			.catch(() => null as any);

		if (!batch || batch.size === 0) break;

		for (const msg of batch.values()) {
			const had = await upsertModmailFromMessage(msg);

			if (had) {
				alreadyHadStreak++;
				if (alreadyHadStreak >= MAX_CONSECUTIVE_ALREADY) {
					container.logger.info('[Stardust] Reached already stored modmail streak; stopping.');
					return;
				}
			} else {
				alreadyHadStreak = 0;
			}
		}

		processed += batch.size;
		before = batch.lastKey();

		await new Promise((resolve) => setTimeout(resolve, 500));
		if (!before) break;
	}

	container.logger.info(`[Stardust] Processed ${processed} modmail messages`);
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

export async function backfillWeeklyRecords() {
	const now = new Date();
	let checkWeek = getISOWeekNumber(now);
	let checkYear = now.getFullYear();

	// Start from previous week
	if (checkWeek === 1) {
		checkYear--;
		checkWeek = getISOWeekNumber(new Date(checkYear, 11, 28));
	} else {
		checkWeek--;
	}

	const MAX_BACKFILL_WEEKS = 10;
	let weeksChecked = 0;

	while (weeksChecked < MAX_BACKFILL_WEEKS) {
		const count = await prisma.weeklyStat.count({
			where: {
				year: checkYear,
				week: checkWeek
			}
		});

		if (count > 0) {
			container.logger.info(`[Stardust] Found existing records for Week ${checkWeek}, ${checkYear}. Stopping backfill.`);
			break;
		}

		container.logger.info(`[Stardust] Backfilling missing records for Week ${checkWeek}, ${checkYear}...`);
		await processWeeklyStats(checkWeek, checkYear);
		container.logger.info(`[Stardust] Finished backfill for Week ${checkWeek}, ${checkYear}.`);

		// Move to previous week
		if (checkWeek === 1) {
			checkYear--;
			checkWeek = getISOWeekNumber(new Date(checkYear, 11, 28));
		} else {
			checkWeek--;
		}
		weeksChecked++;
	}
}
