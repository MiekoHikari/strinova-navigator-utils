import { prisma } from '../../../_core/lib/prisma';
import { getWeekRange } from '../../lib/utils';
import { MonthlyStat, WeeklyStat } from '@prisma/client';
import { container } from '@sapphire/framework';
import { Stopwatch } from '@sapphire/stopwatch';
import { computeWeeklyPointsAndUpdate } from 'stardust/lib/points';

export async function getCurrentMonthPoints(userId: string, month: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[ReportingService] [getCurrentMonthPoints] Calculating points for ${userId} (Month ${month}, ${year})`);

	const stats = await getMonthRecords(userId, month, year);

	const points = await Promise.all(stats.map((stat) => computeWeeklyPointsAndUpdate(stat)));

	const rawPoints = points.reduce((acc, point) => acc + point.totalPoints, 0);
	const finalPoints = points.reduce((acc, point) => acc + point.rawPoints, 0);
	const wastedPoints = rawPoints - finalPoints;

	container.logger.info(
		`[ReportingService] [getCurrentMonthPoints] Completed. Raw: ${rawPoints}, Final: ${finalPoints}, Wasted: ${wastedPoints}. Took ${stopwatch.stop()}`
	);
	return { rawPoints, finalPoints, wastedPoints };
}

export async function getWeeklyRecords(userId: string, week: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[ReportingService] [getWeeklyRecords] Fetching records for ${userId} (Week ${week}, ${year})`);

	// Compute points first
	let stat = await prisma.weeklyStat.findUniqueOrThrow({
		where: {
			moderatorId_year_week: {
				moderatorId: userId,
				year,
				week
			}
		},
		include: { moderator: { include: { user: true } } }
	});

	const result = await computeWeeklyPointsAndUpdate(stat);
	container.logger.debug(`[ReportingService] [getWeeklyRecords] Completed. Took ${stopwatch.stop()}`);
	return result;
}

export async function getMonthRecords(userId: string, month: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[ReportingService] [getMonthRecords] Fetching records for ${userId} (Month ${month}, ${year})`);

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

	container.logger.debug(`[ReportingService] [getMonthRecords] Completed. Found ${stats.length} records. Took ${stopwatch.stop()}`);
	return stats;
}

export async function getMonthlyReport(month: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[ReportingService] [getMonthlyReport] Generating report for Month ${month}, ${year}`);

	let stats = await prisma.monthlyStat.findMany({
		where: {
			month,
			year
		},
		include: { moderator: { include: { user: true } } }
	});

	// Filter out potential bad data (orphaned records)
	stats = stats.filter((s) => s.moderator && s.moderator.user);
	container.logger.debug(`[ReportingService] [getMonthlyReport] Found ${stats.length} monthly records in DB.`);

	// If we don't have a report, check if month has passed yet
	if (stats.length === 0) {
		const now = new Date();
		if (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)) {
			container.logger.error(`[ReportingService] [getMonthlyReport] Attempted to generate report for future month: ${month}/${year}`);
			throw new Error('Cannot generate report for a future month.');
		}

		container.logger.info(`[ReportingService] [getMonthlyReport] Report not found in DB. Aggregating from weekly stats...`);
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

		// Filter out bad weekly stats
		container.logger.debug(`[ReportingService] [getMonthlyReport] Found ${weeklyStats.length} weekly records for aggregation.`);
		const validWeeklyStats = weeklyStats.filter((s) => s.moderatorId);
		container.logger.debug(`[ReportingService] [getMonthlyReport] ${validWeeklyStats.length} weekly records are valid for aggregation.`);

		const aggregatedStats = new Map<string, any>();

		for (const stat of validWeeklyStats) {
			if (!aggregatedStats.has(stat.moderatorId)) {
				if (!stat.moderator || !stat.moderator.user) {
					// Attempt to fetch moderator profile
					const modProfile = await prisma.moderatorProfile.findUnique({
						where: { id: stat.moderatorId },
						include: { user: true }
					});

					if (!modProfile) {
						container.logger.warn(
							`[ReportingService] [getMonthlyReport] Skipping aggregation for moderatorId ${stat.moderatorId} due to missing ModeratorProfile.`
						);
						continue;
					}

					stat.moderator = modProfile;
				}

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
			container.logger.info(`[ReportingService] [getMonthlyReport] Month has passed. Persisting aggregated stats to DB...`);
			container.logger.debug(`[ReportingService] [getMonthlyReport] Persisting ${stats.length} records.`);

			try {
				container.logger.debug(
					`[ReportingService] [getMonthlyReport] Upserting with year=${year} (${typeof year}), month=${month} (${typeof month})`
				);
				stats = await prisma.$transaction(
					stats.map((stat) =>
						prisma.monthlyStat.upsert({
							where: {
								moderatorId_year_month: {
									moderatorId: stat.moderatorId,
									year,
									month
								}
							},
							create: {
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
							},
							update: {
								modChatMessages: stat.modChatMessages,
								publicChatMessages: stat.publicChatMessages,
								voiceChatMinutes: stat.voiceChatMinutes,
								modActionsCount: stat.modActionsCount,
								casesHandledCount: stat.casesHandledCount,
								totalPoints: stat.totalPoints,
								rawPoints: stat.rawPoints
							},
							include: { moderator: { include: { user: true } } }
						})
					)
				);
				container.logger.debug(`[ReportingService] [getMonthlyReport] Persistence successful. Got ${stats.length} records.`);
			} catch (error) {
				container.logger.error(`[ReportingService] [getMonthlyReport] Error persisting stats:`, error);
				throw error;
			}

			// Filter again just in case
			stats = stats.filter((s) => s.moderator && s.moderator.user);
		}
	}

	// Compile report data
	const totalStats = calculateTotalStats(stats);

	container.logger.info(
		`[ReportingService] [getMonthlyReport] Completed. Generated stats for ${stats.length} moderators. Took ${stopwatch.stop()}`
	);
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
