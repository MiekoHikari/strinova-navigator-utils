import { prisma } from '../../../_core/lib/prisma';
import { getDateFromWeekNumber, getWeekRange, getGuild, getChannelsInCategory, getISOWeekNumber } from '../../lib/utils';
import { computeWeightedPoints } from '../../lib/points';
import { envParseString } from '@skyra/env-utilities';
import * as StarStatBot from '../startrack.service';
import { MonthlyStat, WeeklyStat, ModeratorProfile, User } from '@prisma/client';
import { container } from '@sapphire/framework';
import { Stopwatch } from '@sapphire/stopwatch';
import { getModeratorsList } from './profile.service';

export async function fetchModActions(memberId: string, week: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[StatsService] [fetchModActions] Fetching mod actions for ${memberId} (Week ${week}, ${year})`);

	const { startWeek, endWeek } = await getWeekRange(week, year);
	const start = getDateFromWeekNumber(startWeek, year, 'start');
	const end = getDateFromWeekNumber(endWeek, year, 'end');

	const count = await prisma.modAction.count({
		where: {
			moderator: { userId: memberId },
			performedAt: { gte: start, lte: end },
			action: { in: ['BAN', 'WARN', 'MUTE', 'KICK'] }
		}
	});

	container.logger.debug(`[StatsService] [fetchModActions] Completed. Count: ${count}. Took ${stopwatch.stop()}`);
	return count;
}

export async function fetchModmailCases(memberId: string, week: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[StatsService] [fetchModmailCases] Fetching modmail cases for ${memberId} (Week ${week}, ${year})`);

	const { startWeek, endWeek } = await getWeekRange(week, year);
	const start = getDateFromWeekNumber(startWeek, year, 'start');
	const end = getDateFromWeekNumber(endWeek, year, 'end');

	const count = await prisma.modmailThreadClosure.count({
		where: {
			closedByUserId: memberId,
			approved: true,
			closedAt: { gte: start, lte: end }
		}
	});

	container.logger.debug(`[StatsService] [fetchModmailCases] Completed. Count: ${count}. Took ${stopwatch.stop()}`);
	return count;
}

export async function getCurrentMonthPoints(userId: string, month: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[StatsService] [getCurrentMonthPoints] Calculating points for ${userId} (Month ${month}, ${year})`);

	const stats = await getMonthRecords(userId, month, year);

	const points = await Promise.all(stats.map((stat) => computeWeeklyPointsAndUpdate(stat)));

	const rawPoints = points.reduce((acc, point) => acc + point.totalPoints, 0);
	const finalPoints = points.reduce((acc, point) => acc + point.rawPoints, 0);
	const wastedPoints = rawPoints - finalPoints;

	container.logger.info(
		`[StatsService] [getCurrentMonthPoints] Completed. Raw: ${rawPoints}, Final: ${finalPoints}, Wasted: ${wastedPoints}. Took ${stopwatch.stop()}`
	);
	return { rawPoints, finalPoints, wastedPoints };
}

async function computeWeeklyPointsAndUpdate(weeklyStat: WeeklyStat) {
	const stopwatch = new Stopwatch();
	// container.logger.trace(`[StatsService] [computeWeeklyPointsAndUpdate] Computing points for Week ${weeklyStat.week}, ${weeklyStat.year}`);

	const points = computeWeightedPoints({
		modChatMessages: weeklyStat.modChatMessages,
		publicChatMessages: weeklyStat.publicChatMessages,
		voiceChatMinutes: weeklyStat.voiceChatMinutes,
		modActionsTaken: weeklyStat.modActionsCount,
		casesHandled: weeklyStat.casesHandledCount
	});

	const result = await prisma.weeklyStat.update({
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

	// container.logger.trace(`[StatsService] [computeWeeklyPointsAndUpdate] Completed. Took ${stopwatch.stop()}`);
	return result;
}

export async function getWeeklyRecords(userId: string, week: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[StatsService] [getWeeklyRecords] Fetching records for ${userId} (Week ${week}, ${year})`);

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

	const result = await computeWeeklyPointsAndUpdate(stat);
	container.logger.debug(`[StatsService] [getWeeklyRecords] Completed. Took ${stopwatch.stop()}`);
	return result;
}

export async function getMonthRecords(userId: string, month: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[StatsService] [getMonthRecords] Fetching records for ${userId} (Month ${month}, ${year})`);

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

	container.logger.debug(`[StatsService] [getMonthRecords] Completed. Found ${stats.length} records. Took ${stopwatch.stop()}`);
	return stats;
}

export async function getMonthlyReport(month: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[StatsService] [getMonthlyReport] Generating report for Month ${month}, ${year}`);

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
			container.logger.error(`[StatsService] [getMonthlyReport] Attempted to generate report for future month: ${month}/${year}`);
			throw new Error('Cannot generate report for a future month.');
		}

		container.logger.info(`[StatsService] [getMonthlyReport] Report not found in DB. Aggregating from weekly stats...`);
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
			container.logger.info(`[StatsService] [getMonthlyReport] Month has passed. Persisting aggregated stats to DB...`);
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

	container.logger.info(`[StatsService] [getMonthlyReport] Completed. Generated stats for ${stats.length} moderators. Took ${stopwatch.stop()}`);
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
	const stopwatch = new Stopwatch();
	container.logger.debug(`[StatsService] [fetchAllMetrics] Fetching all metrics for ${memberId} (Week ${week}, ${year})`);

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

	container.logger.debug(`[StatsService] [fetchAllMetrics] Completed. Took ${stopwatch.stop()}`);

	return {
		modChatMessages,
		publicChatMessages,
		voiceChatMinutes,
		modActionsTaken,
		casesHandled
	};
}

export async function processWeeklyStats(week: number, year: number, explicitModerators?: (ModeratorProfile & { user: User })[]) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[StatsService] [processWeeklyStats] Starting processing for Week ${week}, ${year}`);

	const moderators = explicitModerators || (await getModeratorsList());
	container.logger.info(`[StatsService] [processWeeklyStats] Found ${moderators.length} moderators to process.`);

	for (const mod of moderators) {
		container.logger.debug(`[StatsService] [processWeeklyStats] Processing metrics for ${mod.user.username} (${mod.userId})...`);
		try {
			const metrics = await fetchAllMetrics(mod.userId, week, year);
			container.logger.trace(`[StatsService] [processWeeklyStats] Metrics for ${mod.user.username}: ${JSON.stringify(metrics)}`);

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
			container.logger.debug(
				`[StatsService] [processWeeklyStats] Updated stats for ${mod.user.username}. Raw=${result.rawPoints}, Total=${result.totalPoints}`
			);
		} catch (error) {
			container.logger.error(`[StatsService] [processWeeklyStats] Error processing stats for ${mod.user.username} (${mod.userId}):`, error);
		}
	}
	container.logger.info(`[StatsService] [processWeeklyStats] Completed processing for Week ${week}, ${year}. Took ${stopwatch.stop()}`);
}

export async function backfillWeeklyRecords() {
	const stopwatch = new Stopwatch();
	container.logger.info(`[StatsService] [backfillWeeklyRecords] Starting backfill process...`);

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
		container.logger.debug(`[StatsService] [backfillWeeklyRecords] Checking Week ${checkWeek}, ${checkYear}...`);

		// Determine time range for the week
		const { startWeek, endWeek } = await getWeekRange(checkWeek, checkYear);
		const start = getDateFromWeekNumber(startWeek, checkYear, 'start');
		const end = getDateFromWeekNumber(endWeek, checkYear, 'end');
		end.setHours(23, 59, 59, 999);

		// 1. Find moderators who took Mod Actions
		const modActionModeratorIds = await prisma.modAction
			.findMany({
				where: {
					performedAt: { gte: start, lte: end },
					moderatorId: { not: null }
				},
				select: { moderatorId: true },
				distinct: ['moderatorId']
			})
			.then((actions) => actions.map((a) => a.moderatorId!));

		// 2. Find moderators who closed Modmail threads
		const modmailUserIds = await prisma.modmailThreadClosure
			.findMany({
				where: {
					closedAt: { gte: start, lte: end }
				},
				select: { closedByUserId: true },
				distinct: ['closedByUserId']
			})
			.then((closures) => closures.map((c) => c.closedByUserId));

		// 3. Fetch ModeratorProfiles for all these users
		const moderatorsToProcess = await prisma.moderatorProfile.findMany({
			where: {
				OR: [{ id: { in: modActionModeratorIds } }, { userId: { in: modmailUserIds } }]
			},
			include: { user: true }
		});

		if (moderatorsToProcess.length > 0) {
			container.logger.info(
				`[StatsService] [backfillWeeklyRecords] Backfilling for Week ${checkWeek}, ${checkYear}. Found ${moderatorsToProcess.length} active/inactive moderators with actions.`
			);
			await processWeeklyStats(checkWeek, checkYear, moderatorsToProcess);
		} else {
			container.logger.info(`[StatsService] [backfillWeeklyRecords] No actions found for Week ${checkWeek}, ${checkYear}. Skipping.`);
		}

		// Move to previous week
		if (checkWeek === 1) {
			checkYear--;
			checkWeek = getISOWeekNumber(new Date(checkYear, 11, 28));
		} else {
			checkWeek--;
		}
		weeksChecked++;
	}

	container.logger.info(`[StatsService] [backfillWeeklyRecords] Completed. Checked ${weeksChecked} weeks. Took ${stopwatch.stop()}`);
}
