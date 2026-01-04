import { WeeklyStat } from '@prisma/client';
import { container } from '@sapphire/framework';
import { Stopwatch } from '@sapphire/stopwatch';
import { prisma } from '_core/lib/prisma';

export type ActivityWeightClass = 'HIGH' | 'MEDIUM' | 'LOW';

// Weight class budgets (fractions of max possible)
export const WEIGHT_BUDGETS: Record<ActivityWeightClass, number> = {
	HIGH: 0.6, // up to 60%
	MEDIUM: 0.25, // up to 25%
	LOW: 0.15 // up to 15%
};

export const CATEGORY_CONFIG = {
	modChatMessages: { weightClass: 'MEDIUM' as ActivityWeightClass, pointsPerUnit: 1 },
	publicChatMessages: { weightClass: 'LOW' as ActivityWeightClass, pointsPerUnit: 0.5 },
	voiceChatMinutes: { weightClass: 'LOW' as ActivityWeightClass, pointsPerUnit: 0.25 },
	modActionsTaken: { weightClass: 'HIGH' as ActivityWeightClass, pointsPerUnit: 10 },
	casesHandled: { weightClass: 'HIGH' as ActivityWeightClass, pointsPerUnit: 20 }
};

export interface IndividualMetrics {
	stardusts: number;
	modChatMessages: number;
	publicChatMessages: number;
	voiceChatMinutes: number;
	modActionsTaken: number;
	casesHandled: number;
}

export interface CategoryPointsDetail {
	category: string;
	weightClass: ActivityWeightClass;
	rawAmount: number;
	rawPoints: number;
	appliedPoints: number;
	wastedPoints: number;
	bracketBudget: number;
}

export interface ComputedPointsResult {
	details: CategoryPointsDetail[];
	totalRawPoints: number;
	totalFinalizedPoints: number;
	totalWastedPoints: number;
	dynamicMaxPossible: number;
}

export function computeWeightedPoints(metrics: Omit<IndividualMetrics, 'stardusts'>): ComputedPointsResult {
	const categories = Object.keys(CATEGORY_CONFIG) as Array<keyof typeof CATEGORY_CONFIG>;

	let dynamicMaxPossible = 0;
	const rawTotalsByClass: Record<ActivityWeightClass, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };

	const interimData = categories.map((key) => {
		const config = CATEGORY_CONFIG[key];
		const amount = metrics[key as keyof typeof metrics] || 0;
		const rawPoints = amount * config.pointsPerUnit;

		dynamicMaxPossible += rawPoints;
		rawTotalsByClass[config.weightClass] += rawPoints;

		return { key, amount, rawPoints, weightClass: config.weightClass };
	});

	const weightBudgetsAbsolute: Record<ActivityWeightClass, number> = {
		HIGH: dynamicMaxPossible * WEIGHT_BUDGETS.HIGH,
		MEDIUM: dynamicMaxPossible * WEIGHT_BUDGETS.MEDIUM,
		LOW: dynamicMaxPossible * WEIGHT_BUDGETS.LOW
	};

	const details: CategoryPointsDetail[] = [];
	let totalFinalizedPoints = 0;
	let totalWastedPoints = 0;

	for (const entry of interimData) {
		const classTotalRaw = rawTotalsByClass[entry.weightClass];
		const classBudget = weightBudgetsAbsolute[entry.weightClass];

		const scalingFactor = classTotalRaw > 0 ? Math.min(1, classBudget / classTotalRaw) : 1;

		const appliedPoints = Math.floor(entry.rawPoints * scalingFactor);
		const wastedPoints = entry.rawPoints - appliedPoints;

		totalFinalizedPoints += appliedPoints;
		totalWastedPoints += wastedPoints;

		details.push({
			category: entry.key,
			weightClass: entry.weightClass,
			rawAmount: entry.amount,
			rawPoints: entry.rawPoints,
			appliedPoints,
			wastedPoints,
			bracketBudget: classBudget
		});
	}

	return { details, totalRawPoints: dynamicMaxPossible, totalFinalizedPoints, totalWastedPoints, dynamicMaxPossible };
}

export async function computeWeeklyPointsAndUpdate(weeklyStat: WeeklyStat) {
	const stopwatch = new Stopwatch();

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
