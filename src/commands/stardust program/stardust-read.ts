import { EnrolledModeratorModel } from '#lib/db/models/EnrolledModerator';
import { GeneratedReportModel } from '#lib/db/models/GeneratedReport';
import { ModeratorTierStatusModel } from '#lib/db/models/ModeratorTierStatus';
import { ModeratorWeeklyPointsModel } from '#lib/db/models/ModeratorWeeklyPoints';
import { generateMonthlyReport } from '#lib/reports';
import { getIndividualReport } from '#lib/stardustTally';
import { getISOWeekNumber, getISOWeekYear, getWeekRange } from '#lib/utils';
import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { envParseString } from '@skyra/env-utilities';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, inlineCode, userMention } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'stardust-read',
	description: 'Read Stardust Program profiles and reports',
	preconditions: [['staffOnly', 'leadModsOnly']],
	subcommands: [
		{ name: 'panel', chatInputRun: 'panel', type: 'method' },
		{ name: 'profile', chatInputRun: 'profile', type: 'method' },
		{ name: 'weekly', chatInputRun: 'weekly', type: 'method' },
		{ name: 'monthly', chatInputRun: 'monthly', type: 'method' }
	]
})
export class StardustReadCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((s) =>
					s.setName('panel').setDescription('Post a panel with a button for moderators to view their profile (ephemeral on click).')
				)
				.addSubcommand((s) =>
					s
						.setName('profile')
						.setDescription('View a moderator stardust profile.')
						.addUserOption((o) => o.setName('user').setDescription('Target moderator (defaults to you)').setRequired(false))
				)
				.addSubcommand((s) =>
					s
						.setName('weekly')
						.setDescription('Read a weekly report (compute on demand if missing).')
						.addUserOption((o) => o.setName('user').setDescription('Target moderator').setRequired(true))
						.addIntegerOption((o) =>
							o.setName('week').setDescription('Week number (1-53)').setRequired(true).setMinValue(1).setMaxValue(53)
						)
						.addIntegerOption((o) => o.setName('year').setDescription('Year').setRequired(true).setMinValue(2000).setMaxValue(2100))
				)
				.addSubcommand((s) =>
					s
						.setName('monthly')
						.setDescription('Generate (or force-regenerate) the monthly leaderboard report.')
						.addIntegerOption((o) => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
						.addIntegerOption((o) => o.setName('year').setDescription('Year').setRequired(true).setMinValue(2000).setMaxValue(2100))
						.addBooleanOption((o) =>
							o.setName('force').setDescription('Force regeneration & repost even if one already exists').setRequired(false)
						)
				)
		);
	}

	// /stardust-read panel
	public async panel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		const embed = new EmbedBuilder()
			.setTitle('View your collected stardusts!')
			.setColor(0xfee75c)
			.setDescription(
				[
					'Click the button below to view your current Stardust Program profile.',
					'Your profile will be sent ephemerally and includes current tier, last 4 weeks summary, and enrollment status.'
				].join('\n')
			);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId('stardust-profile:me').setLabel('View My Stardust Profile').setStyle(ButtonStyle.Primary)
		);

		return interaction.editReply({ embeds: [embed], components: [row] });
	}

	// /stardust-read profile
	public async profile(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const user = interaction.options.getUser('user') ?? interaction.user;
		const embed = await this.buildProfileEmbed(user.id, user.username);
		return interaction.editReply({ embeds: [embed] });
	}

	// /stardust-read weekly
	public async weekly(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const user = interaction.options.getUser('user', true);
		const week = interaction.options.getInteger('week', true);
		const year = interaction.options.getInteger('year', true);
		const guildId = envParseString('MainServer_ID');

		// Try fetch existing snapshot first
		let weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
		if (!weekly) {
			// Compute on demand (this will create/update the weekly doc internally)
			await getIndividualReport(user.id, week, year);
			weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
		}
		if (!weekly) return interaction.editReply({ content: 'Failed to compute weekly report.' });

		const { start, end } = getWeekRange(week, year);
		const effectiveFinalized =
			weekly.overrideActive && typeof weekly.overrideFinalizedPoints === 'number'
				? weekly.overrideFinalizedPoints
				: weekly.totalFinalizedPoints;

		const embed = new EmbedBuilder()
			.setTitle(`Weekly Stardust Report — ${user.username}`)
			.setColor(0x3498db)
			.setDescription(`Week **${week}** (${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)})`)
			.addFields(
				{ name: 'Raw Points', value: weekly.totalRawPoints.toLocaleString(), inline: true },
				{ name: 'Finalized', value: effectiveFinalized.toLocaleString(), inline: true },
				{ name: 'Wasted', value: weekly.totalWastedPoints.toLocaleString(), inline: true },
				{ name: 'Tier After Week', value: String(weekly.tierAfterWeek), inline: true },
				{ name: 'Max Possible (Dynamic)', value: weekly.maxPossiblePoints.toLocaleString(), inline: true }
			)
			.setFooter({
				text: weekly.overrideActive ? 'Override Active' : 'Computed Values'
			});

		if (weekly.overrideActive && weekly.overrideReason) {
			embed.addFields({ name: 'Override Reason', value: weekly.overrideReason.slice(0, 1000) });
		}

		// Category breakdown (truncate if exceeds field limit)
		for (const d of weekly.details.slice(0, 10)) {
			embed.addFields({
				name: `${d.category} (${d.weightClass})`,
				value: `Raw ${d.rawPoints.toLocaleString()}\nApplied ${d.appliedPoints.toLocaleString()}\nWasted ${d.wastedPoints.toLocaleString()}`,
				inline: true
			});
			if (embed.data.fields && embed.data.fields.length >= 24) break; // safety
		}

		return interaction.editReply({ embeds: [embed] });
	}

	// /stardust-read monthly
	public async monthly(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const month = interaction.options.getInteger('month', true); // 1-12
		const year = interaction.options.getInteger('year', true);
		const force = interaction.options.getBoolean('force') ?? false;
		const guildId = envParseString('MainServer_ID');

		if (force) {
			// Remove existing report doc & message to allow fresh regeneration
			const existing = await GeneratedReportModel.findOne({ guildId, type: 'MONTHLY', year, month });
			if (existing) {
				try {
					const guild = await interaction.client.guilds.fetch(guildId);
					const channel = await guild.channels.fetch(existing.channelId!).catch(() => null);
					if (channel && channel.isTextBased() && existing.messageId) {
						await channel.messages.delete(existing.messageId).catch(() => null);
					}
				} catch {
					// swallow
				}
				await GeneratedReportModel.deleteOne({ _id: existing._id });
			}
		}

		try {
			await generateMonthlyReport(year, month);
			return interaction.editReply({
				content: force
					? `Forced regeneration complete (or attempted) for ${year}-${String(month).padStart(2, '0')}. New report should now be posted.`
					: `Monthly report generation triggered for ${year}-${String(month).padStart(2, '0')}. If it didn't already exist, it has now been posted to the configured channel.`
			});
		} catch (e) {
			return interaction.editReply({ content: 'Failed to generate monthly report. Check logs.' });
		}
	}

	private async buildProfileEmbed(userId: string, username: string): Promise<EmbedBuilder> {
		const guildId = envParseString('MainServer_ID');
		const enrollment = await EnrolledModeratorModel.findOne({ guildId, userId });
		const tier = await ModeratorTierStatusModel.findOne({ guildId, userId });
		const active = enrollment?.active ?? false;
		const currentTier = tier?.currentTier ?? 3;

		// Last 4 weeks summary (current week based on now)
		const now = new Date();
		const currentWeek = getISOWeekNumber(now);
		const currentYear = getISOWeekYear(now);
		const lines: string[] = [];
		for (let i = 0; i < 4; i++) {
			// naive: subtract i weeks by date math
			const ref = new Date(now.getTime() - i * 7 * 86400000);
			const w = getISOWeekNumber(ref);
			const wy = getISOWeekYear(ref);
			const weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId, week: w, year: wy });
			if (!weekly) {
				lines.push(`W${w} ${wy}: none`);
			} else {
				const effective =
					weekly.overrideActive && typeof weekly.overrideFinalizedPoints === 'number'
						? weekly.overrideFinalizedPoints
						: weekly.totalFinalizedPoints;
				lines.push(`W${w}: ${effective.toLocaleString()} (${weekly.totalRawPoints.toLocaleString()} raw)`);
			}
		}

		const embed = new EmbedBuilder()
			.setTitle(`Stardust Profile — ${username}`)
			.setColor(active ? 0x2ecc71 : 0x95a5a6)
			.addFields(
				{ name: 'User', value: `${userMention(userId)} (${inlineCode(userId)})`, inline: false },
				{ name: 'Enrollment', value: active ? 'Active' : 'Inactive', inline: true },
				{ name: 'Current Tier', value: String(currentTier), inline: true },
				{ name: 'Recent Weeks', value: lines.join('\n') || 'No data', inline: false }
			)
			.setFooter({ text: `Current Week ${currentWeek} ${currentYear}` });

		return embed;
	}
}
