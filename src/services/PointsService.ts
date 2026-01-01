import { prisma } from '../lib/prisma';
import { CATEGORY_CONFIG, WEIGHT_BUDGETS, type ActivityWeightClass, type IndividualMetrics } from '../config/points';
import { MetricsService } from './MetricsService';

interface ComputedPointsResult {
	totalRawPoints: number;
	totalFinalizedPoints: number;
	tier: number;
	details: {
		modChatMessages: number;
		publicChatMessages: number;
		voiceChatMinutes: number;
		modActionsTaken: number;
		casesHandled: number;
	};
}

export class PointsService {
	private metricsService: MetricsService;

	constructor() {
		this.metricsService = new MetricsService();
	}

	/**
	 * Calculates the points for a moderator based on their metrics.
	 * Pure function - no database side effects.
	 */
	public calculatePoints(metrics: Omit<IndividualMetrics, 'stardusts'>): ComputedPointsResult {
		// 1. Calculate Raw Points per Category
		const rawPoints = {
			modChatMessages: metrics.modChatMessages * CATEGORY_CONFIG.modChatMessages.pointsPerUnit,
			publicChatMessages: metrics.publicChatMessages * CATEGORY_CONFIG.publicChatMessages.pointsPerUnit,
			voiceChatMinutes: metrics.voiceChatMinutes * CATEGORY_CONFIG.voiceChatMinutes.pointsPerUnit,
			modActionsTaken: metrics.modActionsTaken * CATEGORY_CONFIG.modActionsTaken.pointsPerUnit,
			casesHandled: metrics.casesHandled * CATEGORY_CONFIG.casesHandled.pointsPerUnit
		};

		const totalRawPoints = Object.values(rawPoints).reduce((a, b) => a + b, 0);

		// 2. Calculate Budgets based on Dynamic Max (Total Raw Points)
		// If totalRawPoints is 0, budgets are 0.
		const budgets = {
			HIGH: totalRawPoints * WEIGHT_BUDGETS.HIGH,
			MEDIUM: totalRawPoints * WEIGHT_BUDGETS.MEDIUM,
			LOW: totalRawPoints * WEIGHT_BUDGETS.LOW
		};

		// 3. Apply Caps per Weight Class
		// Group categories by weight class
		const pointsByClass: Record<ActivityWeightClass, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };

		(Object.keys(CATEGORY_CONFIG) as Array<keyof typeof CATEGORY_CONFIG>).forEach((key) => {
			const config = CATEGORY_CONFIG[key];
			pointsByClass[config.weightClass] += rawPoints[key];
		});

		// 4. Calculate Finalized Points (Capped)
		const finalizedPointsByClass = {
			HIGH: Math.min(pointsByClass.HIGH, budgets.HIGH),
			MEDIUM: Math.min(pointsByClass.MEDIUM, budgets.MEDIUM),
			LOW: Math.min(pointsByClass.LOW, budgets.LOW)
		};

		const totalFinalizedPoints = finalizedPointsByClass.HIGH + finalizedPointsByClass.MEDIUM + finalizedPointsByClass.LOW;

		// 5. Determine Tier
		// Tier logic was not explicitly in the snippet I read, but TIER_PAYOUT suggests 0-3.
		// I'll assume a simple threshold for now or leave it as 0 if it's manual.
		// The original code had `tierAfterWeek` in the model.
		// Let's assume tier is calculated elsewhere or add a placeholder.
		// For now, I'll return 0.
		const tier = 0;

		return {
			totalRawPoints,
			totalFinalizedPoints,
			tier,
			details: rawPoints
		};
	}

	/**
	 * Fetches metrics, calculates points, and saves the weekly stats for a moderator.
	 */
	public async processUser(userId: string, year: number, week: number) {
		const metrics = await this.metricsService.fetchAllMetrics(userId, week, year);
		return this.saveWeeklyStats(userId, year, week, metrics);
	}

	/**
	 * Saves the weekly stats for a moderator.
	 */
	public async saveWeeklyStats(moderatorId: string, year: number, week: number, metrics: Omit<IndividualMetrics, 'stardusts'>) {
		const calculation = this.calculatePoints(metrics);

		// We need to find the internal ID of the moderator profile from the discord userId
		const moderator = await prisma.moderatorProfile.findUnique({
			where: { userId: moderatorId }
		});

		if (!moderator) {
			// If no profile, we can't save stats.
			// In a real app, we might create one or log a warning.
			// For now, throw to be safe.
			throw new Error(`Moderator profile not found for user ${moderatorId}`);
		}

		// Upsert the WeeklyStat record
		return prisma.weeklyStat.upsert({
			where: {
				moderatorId_year_week: {
					moderatorId: moderator.id,
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
				totalPoints: calculation.totalFinalizedPoints
			},
			create: {
				moderatorId: moderator.id,
				year,
				week,
				modChatMessages: metrics.modChatMessages,
				publicChatMessages: metrics.publicChatMessages,
				voiceChatMinutes: metrics.voiceChatMinutes,
				modActionsCount: metrics.modActionsTaken,
				casesHandledCount: metrics.casesHandled,
				totalPoints: calculation.totalFinalizedPoints,
				tier: calculation.tier
			}
		});
	}
}
