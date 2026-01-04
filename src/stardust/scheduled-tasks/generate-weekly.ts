import { ScheduledTask } from '@sapphire/plugin-scheduled-tasks';
import { syncModActions, syncModmail } from '../services/stardust/sync.service';
import { processWeeklyStats } from '../services/stardust/stats.service';
import { adjustModeratorTiers } from '../services/stardust/tier.service';
import { getISOWeekNumber } from '../lib/utils';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { prisma } from '../../_core/lib/prisma';

export class GenerateWeeklyReport extends ScheduledTask {
	public constructor(context: ScheduledTask.LoaderContext, options: ScheduledTask.Options) {
		super(context, {
			...options,
			pattern: '0 0 * * 1', // Every Monday at midnight,
			timezone: 'UTC',
			name: 'generateWeeklyReport'
		});
	}

	public async run() {
		this.container.logger.info('[Stardust] Starting weekly report generation...');

		// Sync data first
		await syncModActions();
		await syncModmail();

		// Calculate previous week
		const now = new Date();
		const lastWeekDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
		const week = getISOWeekNumber(lastWeekDate);
		const year = lastWeekDate.getFullYear();

		this.container.logger.info(`[Stardust] Generating report for Week ${week}, ${year}`);

		await processWeeklyStats(week, year);
		await adjustModeratorTiers(week, year);

		// Fetch stats
		const stats = await prisma.weeklyStat.findMany({
			where: { week, year },
			include: { moderator: { include: { user: true } } }
		});

		if (!stats.length) {
			this.container.logger.info('[Stardust] No stats found for this week.');
			return;
		}

		// Generate CSV
		const csvHeader = 'Moderator,Mod Chat,Public Chat,Voice (min),Mod Actions,Cases Handled,Raw Points,Total Points\n';
		const csvRows = stats
			.map(
				(s) =>
					`${s.moderator.user.username},${s.modChatMessages},${s.publicChatMessages},${s.voiceChatMinutes},${s.modActionsCount},${s.casesHandledCount},${s.rawPoints},${s.totalPoints}`
			)
			.join('\n');
		const csvBuffer = Buffer.from(csvHeader + csvRows);
		const attachment = new AttachmentBuilder(csvBuffer, { name: `weekly-report-${year}-${week}.csv` });

		const logger = this.container.utilities.guildLogger.getLogger();

		const totalPoints = stats.reduce((acc, s) => acc + s.totalPoints, 0);
		const averagePoints = (totalPoints / stats.length).toFixed(2);

		logger.log({
			files: [attachment],
			embeds: [
				new EmbedBuilder()
					.setTitle(`Weekly Moderator Report - Week ${week}, ${year}`)
					.setColor('Blue')
					.setDescription('Detailed individual weekly report can be found by running the `/stardust read weekly` command.')
					.addFields([
						{ name: 'Total Moderators', value: `${stats.length}`, inline: true },
						{ name: 'Total Points Awarded', value: `${totalPoints}`, inline: true },
						{ name: 'Average Points per Moderator', value: `${averagePoints}`, inline: true }
					])
			]
		});

		this.container.logger.info('[Stardust] Weekly report sent.');
	}
}

declare module '@sapphire/plugin-scheduled-tasks' {
	interface ScheduledTasks {
		generateWeeklyReport: never;
	}
}
