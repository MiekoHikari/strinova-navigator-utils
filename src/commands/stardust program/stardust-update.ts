import { ModeratorTierStatusModel } from '#lib/db/models/ModeratorTierStatus';
import { ModeratorWeeklyPointsModel } from '#lib/db/models/ModeratorWeeklyPoints';
import { getWeekRange } from '#lib/utils';
import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { envParseString } from '@skyra/env-utilities';
import { EmbedBuilder, userMention } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'stardust-update',
	description: 'Update Stardust Program Values',
	preconditions: [['leadModsOnly', 'staffOnly']],
	subcommands: [
		{
			name: 'tier',
			type: 'group',
			entries: [
				{
					name: 'set',
					chatInputRun: 'setTier',
					type: 'method'
				},
				{
					name: 'view',
					chatInputRun: 'viewTier',
					type: 'method'
				}
			]
		},
		{
			name: 'points',
			type: 'group',
			entries: [
				{
					name: 'set',
					chatInputRun: 'setPoints',
					type: 'method'
				},
				{
					name: 'view',
					chatInputRun: 'viewPoints',
					type: 'method'
				}
			]
		}
	]
})
export class UserCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				// Tier group
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
				// Points group
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

	// --- Tier Handlers ---
	public async setTier(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const user = interaction.options.getUser('user', true);
		const tier = interaction.options.getInteger('tier', true);
		const guildId = envParseString('MainServer_ID');

		let doc = await ModeratorTierStatusModel.findOne({ guildId, userId: user.id });
		if (!doc) {
			doc = new ModeratorTierStatusModel({
				guildId,
				userId: user.id,
				currentTier: tier,
				weeksInactive: 0,
				lastEvaluatedWeek: 0,
				lastEvaluatedYear: 0
			});
		} else {
			doc.currentTier = tier;
		}
		await doc.save();

		return interaction.editReply({ content: `Set tier of ${userMention(user.id)} to **${tier}**.` });
	}

	public async viewTier(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const user = interaction.options.getUser('user', true);
		const guildId = envParseString('MainServer_ID');
		const doc = await ModeratorTierStatusModel.findOne({ guildId, userId: user.id });
		if (!doc) return interaction.editReply({ content: `${userMention(user.id)} has no tier record (defaults to 3).` });
		return interaction.editReply({ content: `${userMention(user.id)} current tier: **${doc.currentTier}**.` });
	}

	// --- Points Override Handlers ---
	public async setPoints(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const user = interaction.options.getUser('user', true);
		const week = interaction.options.getInteger('week', true);
		const year = interaction.options.getInteger('year', true);
		const points = interaction.options.getInteger('points');
		const reason = interaction.options.getString('reason') ?? undefined;
		const guildId = envParseString('MainServer_ID');

		const weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
		if (!weekly) {
			return interaction.editReply({ content: 'No weekly record exists yet for that user/week. Run the normal tally first or wait for sync.' });
		}

		if (points === null || points === -1) {
			weekly.overrideActive = false;
			weekly.overrideFinalizedPoints = undefined;
			weekly.overrideReason = reason;
			weekly.overrideAppliedById = interaction.user.id;
			weekly.overrideAppliedAt = new Date();
			await weekly.save();
			return interaction.editReply({ content: `Cleared override for week ${week} ${year} on ${userMention(user.id)}.` });
		}

		weekly.overrideActive = true;
		weekly.overrideFinalizedPoints = points;
		weekly.overrideReason = reason;
		weekly.overrideAppliedById = interaction.user.id;
		weekly.overrideAppliedAt = new Date();
		await weekly.save();

		return interaction.editReply({
			content: `Set override finalized points for week ${week} ${year} on ${userMention(user.id)} to **${points}**.`
		});
	}

	public async viewPoints(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const user = interaction.options.getUser('user', true);
		const week = interaction.options.getInteger('week', true);
		const year = interaction.options.getInteger('year', true);
		const guildId = envParseString('MainServer_ID');

		const weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: user.id, week, year });
		if (!weekly) return interaction.editReply({ content: 'No weekly record found.' });

		const { start, end } = getWeekRange(week, year);
		const embed = new EmbedBuilder()
			.setTitle(`Weekly Points: ${user.username}`)
			.setDescription(`Week ${week} (${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)})`)
			.setColor(0xfee75c)
			.addFields(
				{ name: 'Computed Finalized', value: weekly.totalFinalizedPoints.toLocaleString(), inline: true },
				{ name: 'Raw', value: weekly.totalRawPoints.toLocaleString(), inline: true },
				{ name: 'Max Possible', value: weekly.maxPossiblePoints.toLocaleString(), inline: true },
				{ name: 'Wasted', value: weekly.totalWastedPoints.toLocaleString(), inline: true },
				{ name: 'Tier After Week', value: String(weekly.tierAfterWeek), inline: true }
			);

		if (weekly.overrideActive) {
			embed.addFields(
				{ name: 'Override Active', value: 'Yes', inline: true },
				{ name: 'Override Finalized', value: weekly.overrideFinalizedPoints?.toLocaleString() ?? 'N/A', inline: true }
			);
			if (weekly.overrideReason) embed.addFields({ name: 'Reason', value: weekly.overrideReason.slice(0, 1000) });
		}

		return interaction.editReply({ embeds: [embed] });
	}
}
