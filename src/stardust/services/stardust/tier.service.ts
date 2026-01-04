import { prisma } from '../../../_core/lib/prisma';
import { container } from '@sapphire/framework';
import { getLastWeek } from '../../lib/utils';

export async function adjustModeratorTiers(week: number, year: number) {
	container.logger.info(`[TierService] Starting tier adjustments for Week ${week}, ${year}`);

	const prevWeekObj = getLastWeek(week, year);

	const moderators = await prisma.moderatorProfile.findMany({
		where: { active: true },
		include: {
			weeklyStats: {
				where: {
					OR: [
						{ week, year },
						{ week: prevWeekObj.week, year: prevWeekObj.year }
					]
				}
			},
			user: true
		}
	});

	for (const mod of moderators) {
		const currentStat = mod.weeklyStats.find((s) => s.week === week && s.year === year);
		const prevStat = mod.weeklyStats.find((s) => s.week === prevWeekObj.week && s.year === prevWeekObj.year);

		const isCurrentActive = currentStat ? currentStat.totalPoints >= 10 : false;
		const isPrevActive = prevStat ? prevStat.totalPoints >= 10 : false;

		let newTier = mod.tier;
		let reason = '';

		if (isCurrentActive) {
			// Active: Increase tier by 1, max 3.
			// If currently Tier 4, stay Tier 4.
			if (newTier < 3) {
				newTier++;
				reason = 'Active week (+1)';
			}
		} else {
			// Inactive (< 10 points)
			// Check if previous week was also inactive
			if (!isPrevActive) {
				// 2 consecutive weeks inactive (or more)
				if (newTier > 0) {
					newTier--;
					reason = '2+ weeks inactivity (-1)';
				}
			}
		}

		if (newTier !== mod.tier) {
			await prisma.moderatorProfile.update({
				where: { id: mod.id },
				data: { tier: newTier }
			});
			container.logger.info(`[TierService] Adjusted tier for ${mod.user.username} (${mod.id}): ${mod.tier} -> ${newTier}. Reason: ${reason}`);
		}
	}

	container.logger.info(`[TierService] Completed tier adjustments.`);
}
