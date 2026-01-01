import { backfillRecentReports, generateMonthlyReport } from '#lib/reports';
import { computeWeightedPoints, getIndividualReport } from '#lib/stardustTally';
import { prisma } from '#lib/prisma';
import { TIER_PAYOUT } from '#lib/constants';
import { getISOWeekNumber, getISOWeekYear, getWeekRange } from '#lib/utils';
import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { envParseString } from '@skyra/env-utilities';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, inlineCode, userMention } from 'discord.js';
import { activateEnrollment, deactivateEnrollment, ensureUser, getModeratorsList, getUser } from '#lib/services/stardust.service';
import { Result } from '@sapphire/framework';

@ApplyOptions<Subcommand.Options>({
	name: 'stardust',
	description: 'Stardust Program management and utilities',
	preconditions: [['staffOnly', 'leadModsOnly']],
	subcommands: [
		// Enroll Group
		{
			name: 'enroll',
			type: 'group',
			entries: [
				{ name: 'activate', chatInputRun: 'enrollActivate' },
				{ name: 'deactivate', chatInputRun: 'enrollDeactivate' },
				{ name: 'list', chatInputRun: 'enrollList' }
			]
		},
		// Read Group
		{
			name: 'read',
			type: 'group',
			entries: [
				{ name: 'panel', chatInputRun: 'readPanel' },
				{ name: 'profile', chatInputRun: 'readProfile' },
				{ name: 'weekly', chatInputRun: 'readWeekly' },
				{ name: 'monthly', chatInputRun: 'readMonthly' }
			]
		},
		// Calculator (Subcommand)
		{
			name: 'calculator',
			chatInputRun: 'calculator'
		},
		// Danger Group
		{
			name: 'danger',
			type: 'group',
			entries: [
				{ name: 'backfill', chatInputRun: 'dangerBackfill' },
				{ name: 'clear', chatInputRun: 'dangerClear' }
			]
		},
		// Tier Group
		{
			name: 'tier',
			type: 'group',
			entries: [
				{ name: 'set', chatInputRun: 'tierSet' },
				{ name: 'view', chatInputRun: 'tierView' }
			]
		},
		// Points Group
		{
			name: 'points',
			type: 'group',
			entries: [
				{ name: 'set', chatInputRun: 'pointsSet' },
				{ name: 'view', chatInputRun: 'pointsView' }
			]
		}
	]
})
export class StardustCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				// Enroll Group
				.addSubcommandGroup((group) =>
					group
						.setName('enroll')
						.setDescription('Manage enrollment in the stardust program')
						.addSubcommand((s) =>
							s
								.setName('activate')
								.setDescription('Activate (or create) an enrollment')
								.addUserOption((o) => o.setName('user').setDescription('User to activate (defaults to you)').setRequired(false))
						)
						.addSubcommand((s) =>
							s
								.setName('deactivate')
								.setDescription('Deactivate an enrollment')
								.addUserOption((o) => o.setName('user').setDescription('User to deactivate (defaults to you)').setRequired(false))
						)
						.addSubcommand((s) => s.setName('list').setDescription('List currently active enrolled moderators'))
				)
				// Read Group
				.addSubcommandGroup((group) =>
					group
						.setName('read')
						.setDescription('Read Stardust Program profiles and reports')
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
								.addIntegerOption((o) =>
									o.setName('year').setDescription('Year').setRequired(true).setMinValue(2000).setMaxValue(2100)
								)
						)
						.addSubcommand((s) =>
							s
								.setName('monthly')
								.setDescription('Generate (or force-regenerate) the monthly leaderboard report.')
								.addIntegerOption((o) =>
									o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12)
								)
								.addIntegerOption((o) =>
									o.setName('year').setDescription('Year').setRequired(true).setMinValue(2000).setMaxValue(2100)
								)
								.addBooleanOption((o) =>
									o.setName('force').setDescription('Force regeneration & repost even if one already exists').setRequired(false)
								)
						)
				)
				// Calculator Subcommand
				.addSubcommand((s) =>
					s
						.setName('calculator')
						.setDescription('Calculate projected stardust points, wasted points, and tier outcomes.')
						.addIntegerOption((opt) =>
							opt.setName('mod-chat').setDescription('Moderator chat messages').setMinValue(0).setMaxValue(100_000)
						)
						.addIntegerOption((opt) =>
							opt.setName('public-chat').setDescription('Public chat messages').setMinValue(0).setMaxValue(100_000)
						)
						.addIntegerOption((opt) => opt.setName('voice-minutes').setDescription('Voice minutes').setMinValue(0).setMaxValue(100_000))
						.addIntegerOption((opt) =>
							opt.setName('mod-actions').setDescription('Moderation actions (BAN/WARN/MUTE/KICK)').setMinValue(0).setMaxValue(10_000)
						)
						.addIntegerOption((opt) =>
							opt.setName('cases').setDescription('Approved modmail cases handled').setMinValue(0).setMaxValue(10_000)
						)
						.addIntegerOption((opt) =>
							opt
								.setName('tier')
								.setDescription('Preview payout for a specific manual tier (0-3). Defaults to show all if omitted.')
								.setMinValue(0)
								.setMaxValue(3)
						)
				)
				// Danger Group
				.addSubcommandGroup((group) =>
					group
						.setName('danger')
						.setDescription('Dangerous stardust maintenance operations')
						.addSubcommand((s) => s.setName('backfill').setDescription('Trigger backfill of weekly (12) and monthly (3) reports'))
						.addSubcommand((s) => s.setName('clear').setDescription('Clear ALL generated report records (does not delete messages)'))
				)
				// Tier Group
				.addSubcommandGroup((group) =>
					group
						.setName('tier')
						.setDescription('Manage moderator manual tiers')
						.addSubcommand((sub) =>
							sub
								.setName('set')
								.setDescription("Set a moderator's manual tier (0-3)")
								.addUserOption((o) => o.setName('user').setDescription('Moderator').setRequired(true))
								.addIntegerOption((o) => o.setName('tier').setDescription('Tier 0-3').setRequired(true).setMinValue(0).setMaxValue(3))
						)
						.addSubcommand((sub) =>
							sub
								.setName('view')
								.setDescription("View a moderator's current tier")
								.addUserOption((o) => o.setName('user').setDescription('Moderator').setRequired(true))
						)
				)
				// Points Group
				.addSubcommandGroup((group) =>
					group
						.setName('points')
						.setDescription('Manage weekly stardust point overrides')
						.addSubcommand((sub) =>
							sub
								.setName('set')
								.setDescription('Set or clear a weekly override for a moderator')
								.addUserOption((o) => o.setName('user').setDescription('Moderator').setRequired(true))
								.addIntegerOption((o) =>
									o.setName('week').setDescription('Week number (1-53)').setRequired(true).setMinValue(1).setMaxValue(53)
								)
								.addIntegerOption((o) =>
									o.setName('year').setDescription('Year e.g. 2025').setRequired(true).setMinValue(2000).setMaxValue(2100)
								)
								.addIntegerOption((o) =>
									o
										.setName('points')
										.setDescription('Override finalized points (omit or set -1 to clear)')
										.setRequired(false)
										.setMinValue(-1)
								)
								.addStringOption((o) =>
									o.setName('reason').setDescription('Reason for override').setRequired(false).setMaxLength(500)
								)
						)
						.addSubcommand((sub) =>
							sub
								.setName('view')
								.setDescription('View weekly points + override (if any)')
								.addUserOption((o) => o.setName('user').setDescription('Moderator').setRequired(true))
								.addIntegerOption((o) =>
									o.setName('week').setDescription('Week number (1-53)').setRequired(true).setMinValue(1).setMaxValue(53)
								)
								.addIntegerOption((o) =>
									o.setName('year').setDescription('Year e.g. 2025').setRequired(true).setMinValue(2000).setMaxValue(2100)
								)
						)
				)
		);
	}

	// --- Enroll Handlers ---

	public async enrollActivate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const target = interaction.options.getUser('user', true);

		const userId = target.id;
		const username = target.username;

		const profile = await ensureUser(userId, username);

		const result = await Result.fromAsync(() => activateEnrollment(userId));

		if (result.isErr()) {
			return interaction.editReply({ content: `Failed to activate enrollment:\n \`\`\`${JSON.stringify(result.unwrapErr())}\`\`\`` });
		}

		if (profile.createdAt === profile.updatedAt) {
			return interaction.editReply({ content: `${userMention(userId)} has been enrolled in the Stardust Program! Welcome aboard!` });
		} else {
			return interaction.editReply({ content: `${userMention(userId)}'s enrollment in the Stardust Program has been re-activated!` });
		}
	}

	public async enrollDeactivate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const target = interaction.options.getUser('user', true);

		const userId = target.id;

		// Ensure user exists before fetching profile
		await getUser(userId);

		const result = await Result.fromAsync(() => deactivateEnrollment(userId));

		if (result.isErr()) {
			return interaction.editReply({ content: `Failed to deactivate enrollment:\n \`\`\`${JSON.stringify(result.unwrapErr())}\`\`\`` });
		}

		return interaction.editReply({ content: `${userMention(userId)}'s enrollment in the Stardust Program has been deactivated.` });
	}

	public async enrollList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });

		const moderators = await getModeratorsList();
		if (moderators.length === 0) return interaction.editReply({ content: 'No active enrolled moderators.' });

		const members = moderators.map(
			(mod) => `\`\`\`Username: ${mod.user.username}\n Enrolled At: ${mod.enrolledAt}\n User ID: ${mod.userId}\`\`\``
		);

		return interaction.editReply({ content: `**Active Enrolled Moderators (${moderators.length}):**\n\n${members.join('\n')}` });
	}

	// // --- Read Handlers ---

	// public async readPanel(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply();
	// 	const embed = new EmbedBuilder()
	// 		.setTitle('View your collected stardusts!')
	// 		.setColor(0xfee75c)
	// 		.setDescription(
	// 			[
	// 				'Click the button below to view your current Stardust Program profile.',
	// 				'Your profile will be sent ephemerally and includes current tier, last 4 weeks summary, and enrollment status.'
	// 			].join('\n')
	// 		);

	// 	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
	// 		new ButtonBuilder().setCustomId('stardust-profile:me').setLabel('View My Stardust Profile').setStyle(ButtonStyle.Primary)
	// 	);

	// 	return interaction.editReply({ embeds: [embed], components: [row] });
	// }

	// public async readProfile(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const user = interaction.options.getUser('user') ?? interaction.user;
	// 	const embed = await this.buildProfileEmbed(user.id, user.username);
	// 	return interaction.editReply({ embeds: [embed] });
	// }

	// public async readWeekly(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const user = interaction.options.getUser('user', true);
	// 	const week = interaction.options.getInteger('week', true);
	// 	const year = interaction.options.getInteger('year', true);
	// 	const guildId = envParseString('MainServer_ID');

	// 	// Try fetch existing snapshot first
	// 	let weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
	// 	if (!weekly) {
	// 		// Compute on demand (this will create/update the weekly doc internally)
	// 		await getIndividualReport(user.id, week, year);
	// 		weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
	// 	}
	// 	if (!weekly) return interaction.editReply({ content: 'Failed to compute weekly report.' });

	// 	const { start, end } = getWeekRange(week, year);
	// 	const effectiveFinalized =
	// 		weekly.overrideActive && typeof weekly.overrideFinalizedPoints === 'number'
	// 			? weekly.overrideFinalizedPoints
	// 			: weekly.totalFinalizedPoints;

	// 	const embed = new EmbedBuilder()
	// 		.setTitle(`Weekly Stardust Report — ${user.username}`)
	// 		.setColor(0x3498db)
	// 		.setDescription(`Week **${week}** (${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)})`)
	// 		.addFields(
	// 			{ name: 'Raw Points', value: weekly.totalRawPoints.toLocaleString(), inline: true },
	// 			{ name: 'Finalized', value: effectiveFinalized.toLocaleString(), inline: true },
	// 			{ name: 'Wasted', value: weekly.totalWastedPoints.toLocaleString(), inline: true },
	// 			{ name: 'Tier After Week', value: String(weekly.tierAfterWeek), inline: true },
	// 			{ name: 'Max Possible (Dynamic)', value: weekly.maxPossiblePoints.toLocaleString(), inline: true }
	// 		)
	// 		.setFooter({
	// 			text: weekly.overrideActive ? 'Override Active' : 'Computed Values'
	// 		});

	// 	if (weekly.overrideActive && weekly.overrideReason) {
	// 		embed.addFields({ name: 'Override Reason', value: weekly.overrideReason.slice(0, 1000) });
	// 	}

	// 	// Category breakdown (truncate if exceeds field limit)
	// 	for (const d of weekly.details.slice(0, 10)) {
	// 		embed.addFields({
	// 			name: `${d.category} (${d.weightClass})`,
	// 			value: `Raw ${d.rawPoints.toLocaleString()}\nApplied ${d.appliedPoints.toLocaleString()}\nWasted ${d.wastedPoints.toLocaleString()}`,
	// 			inline: true
	// 		});
	// 		if (embed.data.fields && embed.data.fields.length >= 24) break; // safety
	// 	}

	// 	return interaction.editReply({ embeds: [embed] });
	// }

	// public async readMonthly(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const month = interaction.options.getInteger('month', true); // 1-12
	// 	const year = interaction.options.getInteger('year', true);
	// 	const force = interaction.options.getBoolean('force') ?? false;
	// 	const guildId = envParseString('MainServer_ID');

	// 	if (force) {
	// 		// Remove existing report doc & message to allow fresh regeneration
	// 		const existing = await GeneratedReportModel.findOne({ guildId, type: 'MONTHLY', year, month });
	// 		if (existing) {
	// 			try {
	// 				const guild = await interaction.client.guilds.fetch(guildId);
	// 				const channel = await guild.channels.fetch(existing.channelId!).catch(() => null);
	// 				if (channel && channel.isTextBased() && existing.messageId) {
	// 					await channel.messages.delete(existing.messageId).catch(() => null);
	// 				}
	// 			} catch {
	// 				// swallow
	// 			}
	// 			await GeneratedReportModel.deleteOne({ _id: existing._id });
	// 		}
	// 	}

	// 	try {
	// 		await generateMonthlyReport(year, month);
	// 		return interaction.editReply({
	// 			content: force
	// 				? `Forced regeneration complete (or attempted) for ${year}-${String(month).padStart(2, '0')}. New report should now be posted.`
	// 				: `Monthly report generation triggered for ${year}-${String(month).padStart(2, '0')}. If it didn't already exist, it has now been posted to the configured channel.`
	// 		});
	// 	} catch (e) {
	// 		return interaction.editReply({ content: 'Failed to generate monthly report. Check logs.' });
	// 	}
	// }

	// // --- Calculator Handler ---

	// public async calculator(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });

	// 	const modChatMessages = interaction.options.getInteger('mod-chat') ?? 0;
	// 	const publicChatMessages = interaction.options.getInteger('public-chat') ?? 0;
	// 	const voiceChatMinutes = interaction.options.getInteger('voice-minutes') ?? 0;
	// 	const modActionsTaken = interaction.options.getInteger('mod-actions') ?? 0;
	// 	const casesHandled = interaction.options.getInteger('cases') ?? 0;

	// 	const { details, totalRawPoints, totalFinalizedPoints, totalWastedPoints, dynamicMaxPossible } = computeWeightedPoints({
	// 		modChatMessages,
	// 		publicChatMessages,
	// 		voiceChatMinutes,
	// 		modActionsTaken,
	// 		casesHandled
	// 	});

	// 	// Manual tiers now: optionally preview a specific tier payout or show all
	// 	const selectedTier = interaction.options.getInteger('tier');
	// 	let tierFieldValue: string;
	// 	if (selectedTier !== null) {
	// 		const t = Math.min(3, Math.max(0, selectedTier)) as 0 | 1 | 2 | 3;
	// 		tierFieldValue = `${t} (Payout: ${TIER_PAYOUT[t].toLocaleString()})`;
	// 	} else {
	// 		tierFieldValue = Object.entries(TIER_PAYOUT)
	// 			.map(([tier, payout]) => `${tier}: ${payout.toLocaleString()}`)
	// 			.join(' | ');
	// 	}

	// 	const embed = new EmbedBuilder()
	// 		.setTitle('Stardust Calculator')
	// 		.setColor(0xfee75c)
	// 		.setDescription('Hypothetical weekly activity projection')
	// 		.addFields(
	// 			{
	// 				name: 'Inputs',
	// 				value: [
	// 					`Mod Chat: **${modChatMessages.toLocaleString()}**`,
	// 					`Public Chat: **${publicChatMessages.toLocaleString()}**`,
	// 					`Voice Minutes: **${voiceChatMinutes.toLocaleString()}**`,
	// 					`Mod Actions: **${modActionsTaken.toLocaleString()}**`,
	// 					`Cases: **${casesHandled.toLocaleString()}**`
	// 				].join('\n'),
	// 				inline: false
	// 			},
	// 			{
	// 				name: 'Totals',
	// 				value: [
	// 					`Dynamic Max Possible: **${dynamicMaxPossible.toLocaleString()}**`,
	// 					`Raw Points: **${totalRawPoints.toLocaleString()}**`,
	// 					`Finalized (Stardust): **${totalFinalizedPoints.toLocaleString()}**`,
	// 					`Wasted: **${totalWastedPoints.toLocaleString()}**`
	// 				].join('\n'),
	// 				inline: false
	// 			},
	// 			{
	// 				name: selectedTier !== null ? 'Selected Tier' : 'Tier Payouts',
	// 				value: tierFieldValue,
	// 				inline: true
	// 			},
	// 			{
	// 				name: 'Effective Utilization',
	// 				value: `${dynamicMaxPossible ? ((totalFinalizedPoints / dynamicMaxPossible) * 100).toFixed(1) : '0'}%`,
	// 				inline: true
	// 			}
	// 		);

	// 	// Per-category breakdown
	// 	for (const d of details) {
	// 		embed.addFields({
	// 			name: `${d.category} (${d.weightClass})`,
	// 			value: `Raw: ${d.rawPoints.toLocaleString()}\nApplied: ${d.appliedPoints.toLocaleString()}\nWasted: ${d.wastedPoints.toLocaleString()}\nBudget: ${Math.round(d.bracketBudget).toLocaleString()}`,
	// 			inline: true
	// 		});
	// 	}

	// 	// If too many fields (Discord limit 25), we may need to chunk; simple safeguard
	// 	if (embed.data.fields && embed.data.fields.length > 25) {
	// 		// Trim detail fields if excessive
	// 		embed.data.fields = embed.data.fields.slice(0, 25);
	// 	}

	// 	await interaction.editReply({ embeds: [embed] });
	// }

	// // --- Danger Handlers ---

	// public async dangerBackfill(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	await backfillRecentReports();
	// 	return interaction.editReply({ content: 'Backfill operation completed (or skipped if none active).' });
	// }

	// public async dangerClear(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const guildId = envParseString('MainServer_ID');
	// 	const { deletedCount } = await GeneratedReportModel.deleteMany({ guildId });
	// 	return interaction.editReply({ content: `Cleared ${deletedCount} generated report record(s). Messages in channels were not deleted.` });
	// }

	// // --- Tier Handlers ---

	// public async tierSet(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const user = interaction.options.getUser('user', true);
	// 	const tier = interaction.options.getInteger('tier', true);
	// 	const guildId = envParseString('MainServer_ID');

	// 	let doc = await ModeratorTierStatusModel.findOne({ guildId, userId: user.id });
	// 	if (!doc) {
	// 		doc = new ModeratorTierStatusModel({
	// 			guildId,
	// 			userId: user.id,
	// 			currentTier: tier,
	// 			weeksInactive: 0,
	// 			lastEvaluatedWeek: 0,
	// 			lastEvaluatedYear: 0
	// 		});
	// 	} else {
	// 		doc.currentTier = tier;
	// 	}
	// 	await doc.save();

	// 	return interaction.editReply({ content: `Set tier of ${userMention(user.id)} to **${tier}**.` });
	// }

	// public async tierView(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const user = interaction.options.getUser('user', true);
	// 	const guildId = envParseString('MainServer_ID');
	// 	const doc = await ModeratorTierStatusModel.findOne({ guildId, userId: user.id });
	// 	if (!doc) return interaction.editReply({ content: `${userMention(user.id)} has no tier record (defaults to 3).` });
	// 	return interaction.editReply({ content: `${userMention(user.id)} current tier: **${doc.currentTier}**.` });
	// }

	// // --- Points Handlers ---

	// public async pointsSet(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const user = interaction.options.getUser('user', true);
	// 	const week = interaction.options.getInteger('week', true);
	// 	const year = interaction.options.getInteger('year', true);
	// 	const points = interaction.options.getInteger('points');
	// 	const reason = interaction.options.getString('reason') ?? undefined;
	// 	const guildId = envParseString('MainServer_ID');

	// 	const weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
	// 	if (!weekly) {
	// 		return interaction.editReply({ content: 'No weekly record exists yet for that user/week. Run the normal tally first or wait for sync.' });
	// 	}

	// 	if (points === null || points === -1) {
	// 		weekly.overrideActive = false;
	// 		weekly.overrideFinalizedPoints = undefined;
	// 		weekly.overrideReason = reason;
	// 		weekly.overrideAppliedById = interaction.user.id;
	// 		weekly.overrideAppliedAt = new Date();
	// 		await weekly.save();
	// 		return interaction.editReply({ content: `Cleared override for week ${week} ${year} on ${userMention(user.id)}.` });
	// 	}

	// 	weekly.overrideActive = true;
	// 	weekly.overrideFinalizedPoints = points;
	// 	weekly.overrideReason = reason;
	// 	weekly.overrideAppliedById = interaction.user.id;
	// 	weekly.overrideAppliedAt = new Date();
	// 	await weekly.save();

	// 	return interaction.editReply({
	// 		content: `Set override finalized points for week ${week} ${year} on ${userMention(user.id)} to **${points}**.`
	// 	});
	// }

	// public async pointsView(interaction: Subcommand.ChatInputCommandInteraction) {
	// 	await interaction.deferReply({ flags: ['Ephemeral'] });
	// 	const user = interaction.options.getUser('user', true);
	// 	const week = interaction.options.getInteger('week', true);
	// 	const year = interaction.options.getInteger('year', true);
	// 	const guildId = envParseString('MainServer_ID');

	// 	const weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
	// 	if (!weekly) return interaction.editReply({ content: 'No weekly record found.' });

	// 	const { start, end } = getWeekRange(week, year);
	// 	const embed = new EmbedBuilder()
	// 		.setTitle(`Weekly Points: ${user.username}`)
	// 		.setDescription(`Week ${week} (${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)})`)
	// 		.setColor(0xfee75c)
	// 		.addFields(
	// 			{ name: 'Computed Finalized', value: weekly.totalFinalizedPoints.toLocaleString(), inline: true },
	// 			{ name: 'Raw', value: weekly.totalRawPoints.toLocaleString(), inline: true },
	// 			{ name: 'Max Possible', value: weekly.maxPossiblePoints.toLocaleString(), inline: true },
	// 			{ name: 'Wasted', value: weekly.totalWastedPoints.toLocaleString(), inline: true },
	// 			{ name: 'Tier After Week', value: String(weekly.tierAfterWeek), inline: true }
	// 		);

	// 	if (weekly.overrideActive) {
	// 		embed.addFields(
	// 			{ name: 'Override Active', value: 'Yes', inline: true },
	// 			{ name: 'Override Finalized', value: weekly.overrideFinalizedPoints?.toLocaleString() ?? 'N/A', inline: true }
	// 		);
	// 		if (weekly.overrideReason) embed.addFields({ name: 'Reason', value: weekly.overrideReason.slice(0, 1000) });
	// 	}

	// 	return interaction.editReply({ embeds: [embed] });
	// }

	// // --- Helpers ---

	// private async buildProfileEmbed(userId: string, username: string): Promise<EmbedBuilder> {
	// 	const guildId = envParseString('MainServer_ID');
	// 	const enrollment = await EnrolledModeratorModel.findOne({ guildId, userId });
	// 	const tier = await ModeratorTierStatusModel.findOne({ guildId, userId });
	// 	const active = enrollment?.active ?? false;
	// 	const currentTier = tier?.currentTier ?? 3;

	// 	// Last 4 weeks summary (current week based on now)
	// 	const now = new Date();
	// 	const currentWeek = getISOWeekNumber(now);
	// 	const currentYear = getISOWeekYear(now);
	// 	const lines: string[] = [];
	// 	for (let i = 0; i < 4; i++) {
	// 		// naive: subtract i weeks by date math
	// 		const ref = new Date(now.getTime() - i * 7 * 86400000);
	// 		const w = getISOWeekNumber(ref);
	// 		const wy = getISOWeekYear(ref);
	// 		const weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId, week: w, year: wy });
	// 		if (!weekly) {
	// 			lines.push(`W${w} ${wy}: none`);
	// 		} else {
	// 			const effective =
	// 				weekly.overrideActive && typeof weekly.overrideFinalizedPoints === 'number'
	// 					? weekly.overrideFinalizedPoints
	// 					: weekly.totalFinalizedPoints;
	// 			lines.push(`W${w}: ${effective.toLocaleString()} (${weekly.totalRawPoints.toLocaleString()} raw)`);
	// 		}
	// 	}

	// 	const embed = new EmbedBuilder()
	// 		.setTitle(`Stardust Profile — ${username}`)
	// 		.setColor(active ? 0x2ecc71 : 0x95a5a6)
	// 		.addFields(
	// 			{ name: 'User', value: `${userMention(userId)} (${inlineCode(userId)})`, inline: false },
	// 			{ name: 'Enrollment', value: active ? 'Active' : 'Inactive', inline: true },
	// 			{ name: 'Current Tier', value: String(currentTier), inline: true },
	// 			{ name: 'Recent Weeks', value: lines.join('\n') || 'No data', inline: false }
	// 		)
	// 		.setFooter({ text: `Current Week ${currentWeek} ${currentYear}` });

	// 	return embed;
	// }
}
