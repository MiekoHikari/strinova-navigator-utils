import { ScheduledTask } from '@sapphire/plugin-scheduled-tasks';
import { syncModActions, syncModmail } from '../services/stardust/sync.service';
import { getMonthlyReport } from '../services/stardust/stats.service';
import { envParseString } from '@skyra/env-utilities';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';

export class GenerateMonthlyReport extends ScheduledTask {
	public constructor(context: ScheduledTask.LoaderContext, options: ScheduledTask.Options) {
		super(context, {
			...options,
			pattern: '5 0 1 * *', // 1st of every month at 00:05 AM
			timezone: 'UTC',
			name: 'generateMonthlyReport'
		});
	}

	public async run() {
		this.container.logger.info('[Stardust] Starting monthly report generation...');

		// Sync data first
		await syncModActions();
		await syncModmail();

		// Calculate previous month
		const now = new Date();
		const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const month = lastMonthDate.getMonth() + 1; // 1-based
		const year = lastMonthDate.getFullYear();

		this.container.logger.info(`[Stardust] Generating report for Month ${month}, ${year}`);

		const { stats, totalStats } = await getMonthlyReport(month, year);

		if (!stats.length) {
			this.container.logger.info('[Stardust] No stats found for this month.');
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
		const attachment = new AttachmentBuilder(csvBuffer, { name: `monthly-report-${year}-${month}.csv` });

		// Generate Embed
		const embed = new EmbedBuilder()
			.setTitle(`Monthly Report - ${month}/${year}`)
			.setDescription(`Stats for ${stats.length} moderators.`)
			.addFields(
				{ name: 'Total Points', value: totalStats.finalPoints.toString(), inline: true },
				{ name: 'Total Actions', value: totalStats.modActionsCount.toString(), inline: true },
				{ name: 'Total Cases', value: totalStats.casesHandledCount.toString(), inline: true }
			)
			.setColor('Gold')
			.setTimestamp();

		// Send to channel
		const channelId = envParseString('MainServer_MonthlyReportChannelID');
		const guildId = envParseString('MainServer_ID');
		const guild = await this.container.client.guilds.fetch(guildId);
		const channel = await guild.channels.fetch(channelId);

		if (channel?.isTextBased()) {
			await channel.send({ embeds: [embed], files: [attachment] });
		}

		this.container.logger.info('[Stardust] Monthly report sent.');
	}
}

declare module '@sapphire/plugin-scheduled-tasks' {
	interface ScheduledTasks {
		generateMonthlyReport: never;
	}
}
