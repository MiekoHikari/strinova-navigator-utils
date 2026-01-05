import { prisma } from '../../../_core/lib/prisma';
import { getDateFromWeekNumber, getISOWeekNumber, getLastWeek, getGuild, getChannelsInCategory } from '../../lib/utils';
import { ModeratorProfile, User } from '@prisma/client';
import { container } from '@sapphire/framework';
import { Stopwatch } from '@sapphire/stopwatch';
import { getModeratorsList } from './profile.service';
import { computeWeeklyPointsAndUpdate } from '../../lib/points';
import { envParseString } from '@skyra/env-utilities';
import * as StarStatBot from '../startrack.service';

export async function processWeeklyStats(week: number, year: number, explicitModerators?: (ModeratorProfile & { user: User })[]) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[StatsService] [processWeeklyStats] Starting processing for Week ${week}, ${year}`);

	const moderators = explicitModerators || (await getModeratorsList());
	container.logger.info(`[StatsService] [processWeeklyStats] Found ${moderators.length} moderators to process.`);

	const start = getDateFromWeekNumber(week, year, 'start');
	const end = getDateFromWeekNumber(week, year, 'end');

	const serverID = envParseString('MainServer_ID');
	const guild = await getGuild(serverID);
	const modChatChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModChatCategoryID'));
	const modCommandsChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModCommandsCategoryID'));

	const modActionCounts = await prisma.modAction.groupBy({
		by: ['moderatorId'],
		where: {
			performedAt: { gte: start, lte: end },
			action: { in: ['BAN', 'WARN', 'MUTE', 'KICK'] },
			moderatorId: { in: moderators.map((m) => m.id) }
		},
		_count: { _all: true }
	});

	const modmailCounts = await prisma.modmailThreadClosure.groupBy({
		by: ['closedByUserId'],
		where: {
			closedAt: { gte: start, lte: end },
			approved: true,
			closedByUserId: { in: moderators.map((m) => m.id) }
		},
		_count: { _all: true }
	});

	const modActionMap = new Map(modActionCounts.map((item) => [item.moderatorId, item._count._all]));
	const modmailMap = new Map(modmailCounts.map((item) => [item.closedByUserId, item._count._all]));

	for (const mod of moderators) {
		container.logger.debug(`[StatsService] [processWeeklyStats] Processing metrics for ${mod.user.username} (${mod.id})...`);
		try {
			const [modChatMessages, publicChatMessages, voiceChatMinutes] = await Promise.all([
				StarStatBot.fetchModChatMessageCount({ moderatorId: mod.id, week, year, serverID, channelIds: modChatChannelIds }),
				StarStatBot.fetchPublicChatMessageCount({
					moderatorId: mod.id,
					week,
					year,
					serverID,
					channelIds: [...modChatChannelIds, ...modCommandsChannelIds]
				}),
				StarStatBot.fetchVoiceMinutes({
					moderatorId: mod.id,
					week,
					year,
					serverID,
					channelIds: [...modChatChannelIds, ...modCommandsChannelIds]
				})
			]);

			const modActionsTaken = modActionMap.get(mod.id) || 0;
			const casesHandled = modmailMap.get(mod.id) || 0;

			const upsertedStat = await prisma.weeklyStat.upsert({
				where: {
					moderatorId_year_week: {
						moderatorId: mod.id,
						year,
						week
					}
				},
				update: {
					modChatMessages,
					publicChatMessages,
					voiceChatMinutes,
					modActionsCount: modActionsTaken,
					casesHandledCount: casesHandled,
					updatedAt: new Date()
				},
				create: {
					moderator: {
						connect: { id: mod.id }
					},
					year,
					week,
					modChatMessages,
					publicChatMessages,
					voiceChatMinutes,
					modActionsCount: modActionsTaken,
					casesHandledCount: casesHandled,
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

async function isBackfillNeeded(currentWeek: number, currentYear: number): Promise<boolean> {
	const lastPersistedStat = await prisma.weeklyStat.findFirst({
		orderBy: [{ year: 'desc' }, { week: 'desc' }]
	});

	const isUpToDate = lastPersistedStat ? lastPersistedStat.week === currentWeek && lastPersistedStat.year === currentYear : false;

	return !isUpToDate;
}

async function getModeratorsWithActivity(start: Date, end: Date) {
	const modActionModeratorIds = await prisma.modAction
		.groupBy({
			by: ['moderatorId'],
			where: {
				performedAt: { gte: start, lte: end },
				moderatorId: { not: null }
			}
		})
		.then((actions) => actions.map((a) => a.moderatorId!));

	const modmailUserIds = await prisma.modmailThreadClosure
		.groupBy({
			by: ['closedByUserId'],
			where: {
				closedAt: { gte: start, lte: end }
			}
		})
		.then((closures) => closures.map((c) => c.closedByUserId));

	return { modActionModeratorIds, modmailUserIds };
}

async function processBackfillForWeek(week: number, year: number) {
	container.logger.debug(`[StatsService] [backfillWeeklyRecords] Checking Week ${week}, ${year}...`);

	const start = getDateFromWeekNumber(week, year, 'start');
	const end = getDateFromWeekNumber(week, year, 'end');

	const { modActionModeratorIds, modmailUserIds } = await getModeratorsWithActivity(start, end);

	const moderatorsToProcess = await prisma.moderatorProfile.findMany({
		where: {
			OR: [{ id: { in: modActionModeratorIds } }, { id: { in: modmailUserIds } }, { active: true }]
		},
		include: { user: true }
	});

	if (moderatorsToProcess.length > 0) {
		container.logger.info(
			`[StatsService] [backfillWeeklyRecords] Backfilling for Week ${week}, ${year}. Found ${moderatorsToProcess.length} active/inactive moderators with actions.`
		);

		await processWeeklyStats(week, year, moderatorsToProcess);
	} else {
		container.logger.info(`[StatsService] [backfillWeeklyRecords] No actions found for Week ${week}, ${year}. Skipping.`);
	}
}

export async function backfillWeeklyRecords() {
	const stopwatch = new Stopwatch();
	container.logger.info(`[StatsService] [backfillWeeklyRecords] Starting backfill process...`);

	const now = new Date();

	let { week, year } = getLastWeek(getISOWeekNumber(now), now.getFullYear());

	const shouldBackfill = await isBackfillNeeded(week, year);
	let weeksChecked = 0;

	if (!shouldBackfill) {
		container.logger.info(
			`[StatsService] [backfillWeeklyRecords] Last persisted week (${week}, ${year}) is the most recent week. Skipping backfill`
		);
	} else {
		const MAX_BACKFILL_WEEKS = 4;

		while (weeksChecked < MAX_BACKFILL_WEEKS) {
			await processBackfillForWeek(week, year);

			// Move to previous week
			if (week === 1) {
				year--;
				week = getISOWeekNumber(new Date(year, 11, 28));
			} else {
				week--;
			}
			weeksChecked++;
		}
	}

	container.logger.info(`[StatsService] [backfillWeeklyRecords] Completed. Checked ${weeksChecked} weeks. Took ${stopwatch.stop()}`);
}
