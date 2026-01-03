import { prisma } from '../../../_core/lib/prisma';
import { getDateFromWeekNumber, getISOWeekNumber } from '../../lib/utils';
import { computeWeightedPoints } from '../../lib/points';
import { WeeklyStat, ModeratorProfile, User } from '@prisma/client';
import { container } from '@sapphire/framework';
import { Stopwatch } from '@sapphire/stopwatch';
import { getModeratorsList } from './profile.service';
import { fetchAllMetrics } from './metrics.service';

export async function computeWeeklyPointsAndUpdate(weeklyStat: WeeklyStat) {
	const stopwatch = new Stopwatch();
	container.logger.trace(`[StatsService] [computeWeeklyPointsAndUpdate] Computing points for Week ${weeklyStat.week}, ${weeklyStat.year}`);

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

	container.logger.trace(`[StatsService] [computeWeeklyPointsAndUpdate] Completed. Took ${stopwatch.stop()}`);
	return result;
}

export async function processWeeklyStats(week: number, year: number, explicitModerators?: (ModeratorProfile & { user: User })[]) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[StatsService] [processWeeklyStats] Starting processing for Week ${week}, ${year}`);

	const moderators = explicitModerators || (await getModeratorsList());
	container.logger.info(`[StatsService] [processWeeklyStats] Found ${moderators.length} moderators to process.`);

	for (const mod of moderators) {
		container.logger.debug(`[StatsService] [processWeeklyStats] Processing metrics for ${mod.user.username} (${mod.id})...`);
		try {
			const metrics = await fetchAllMetrics(mod.id, week, year);
			container.logger.trace(`[StatsService] [processWeeklyStats] Metrics for ${mod.user.username} have been fetched.`);

			const upsertedStat = await prisma.weeklyStat.upsert({
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
					moderator: {
						connect: { id: mod.id }
					},
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

			const result = await computeWeeklyPointsAndUpdate(upsertedStat);
			container.logger.debug(
				`[StatsService] [processWeeklyStats] Updated stats for ${mod.user.username}. Raw=${result.rawPoints}, Total=${result.totalPoints}`
			);
		} catch (error) {
			container.logger.error(`[StatsService] [processWeeklyStats] Error processing stats for ${mod.user.username} (${mod.id}):`, error);
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

	// If last persisted week is last week, skip it

	const lastPersisted = await prisma.weeklyStat
		.findFirst({
			orderBy: [{ year: 'desc' }, { week: 'desc' }]
		})
		.then((stat) => (stat ? checkWeek === stat.week && checkYear === stat.year : false));

	if (lastPersisted) {
		container.logger.info(
			`[StatsService] [backfillWeeklyRecords] Last persisted week (${checkWeek}, ${checkYear}) is the most recent week. Skipping backfill`
		);

		return;
	}

	// Start from previous week
	if (checkWeek === 1) {
		checkYear--;
		checkWeek = getISOWeekNumber(new Date(checkYear, 11, 28));
	} else {
		checkWeek--;
	}

	const MAX_BACKFILL_WEEKS = 4;
	let weeksChecked = 0;

	while (weeksChecked < MAX_BACKFILL_WEEKS) {
		container.logger.debug(`[StatsService] [backfillWeeklyRecords] Checking Week ${checkWeek}, ${checkYear}...`);

		// Determine time range for the week
		const start = getDateFromWeekNumber(checkWeek, checkYear, 'start');
		const end = getDateFromWeekNumber(checkWeek, checkYear, 'end');

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
				OR: [{ id: { in: modActionModeratorIds } }, { id: { in: modmailUserIds } }, { active: true }]
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
