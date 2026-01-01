import { prisma } from '@modules/_core/lib/prisma';
import { getWeekRange } from '../lib/utils';
import { computeWeightedPoints } from '../lib/points';
import { MonthlyStat, WeeklyStat } from '@prisma/client';

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
	let stats: MonthlyStat[] = await prisma.monthlyStat.findMany({
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
