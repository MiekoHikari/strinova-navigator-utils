import { computeWeightedPoints, TIER_PAYOUT } from '#lib/stardustTally';
import { ApplyOptions } from '@sapphire/decorators';
import { ChatInputCommand, Command } from '@sapphire/framework';
import { EmbedBuilder } from 'discord.js';

@ApplyOptions<ChatInputCommand.Options>({
	name: 'stardust-calculator',
	description: 'Calculate projected stardust points, wasted points, and tier outcomes for hypothetical activity.',
	preconditions: [['leadModsOnly', 'staffOnly']]
})
export class CalculatorCommand extends Command {
	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((opt) => opt.setName('mod-chat').setDescription('Moderator chat messages').setMinValue(0).setMaxValue(100_000))
				.addIntegerOption((opt) => opt.setName('public-chat').setDescription('Public chat messages').setMinValue(0).setMaxValue(100_000))
				.addIntegerOption((opt) => opt.setName('voice-minutes').setDescription('Voice minutes').setMinValue(0).setMaxValue(100_000))
				.addIntegerOption((opt) =>
					opt.setName('mod-actions').setDescription('Moderation actions (BAN/WARN/MUTE/KICK)').setMinValue(0).setMaxValue(10_000)
				)
				.addIntegerOption((opt) => opt.setName('cases').setDescription('Approved modmail cases handled').setMinValue(0).setMaxValue(10_000))
				.addIntegerOption((opt) =>
					opt
						.setName('tier')
						.setDescription('Preview payout for a specific manual tier (0-3). Defaults to show all if omitted.')
						.setMinValue(0)
						.setMaxValue(3)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });

		const modChatMessages = interaction.options.getInteger('mod-chat') ?? 0;
		const publicChatMessages = interaction.options.getInteger('public-chat') ?? 0;
		const voiceChatMinutes = interaction.options.getInteger('voice-minutes') ?? 0;
		const modActionsTaken = interaction.options.getInteger('mod-actions') ?? 0;
		const casesHandled = interaction.options.getInteger('cases') ?? 0;

		const { details, totalRawPoints, totalFinalizedPoints, totalWastedPoints, dynamicMaxPossible } = computeWeightedPoints({
			modChatMessages,
			publicChatMessages,
			voiceChatMinutes,
			modActionsTaken,
			casesHandled
		});

		// Manual tiers now: optionally preview a specific tier payout or show all
		const selectedTier = interaction.options.getInteger('tier');
		let tierFieldValue: string;
		if (selectedTier !== null) {
			const t = Math.min(3, Math.max(0, selectedTier)) as 0 | 1 | 2 | 3;
			tierFieldValue = `${t} (Payout: ${TIER_PAYOUT[t].toLocaleString()})`;
		} else {
			tierFieldValue = Object.entries(TIER_PAYOUT)
				.map(([tier, payout]) => `${tier}: ${payout.toLocaleString()}`)
				.join(' | ');
		}

		const embed = new EmbedBuilder()
			.setTitle('Stardust Calculator')
			.setColor(0xfee75c)
			.setDescription('Hypothetical weekly activity projection')
			.addFields(
				{
					name: 'Inputs',
					value: [
						`Mod Chat: **${modChatMessages.toLocaleString()}**`,
						`Public Chat: **${publicChatMessages.toLocaleString()}**`,
						`Voice Minutes: **${voiceChatMinutes.toLocaleString()}**`,
						`Mod Actions: **${modActionsTaken.toLocaleString()}**`,
						`Cases: **${casesHandled.toLocaleString()}**`
					].join('\n'),
					inline: false
				},
				{
					name: 'Totals',
					value: [
						`Dynamic Max Possible: **${dynamicMaxPossible.toLocaleString()}**`,
						`Raw Points: **${totalRawPoints.toLocaleString()}**`,
						`Finalized (Stardust): **${totalFinalizedPoints.toLocaleString()}**`,
						`Wasted: **${totalWastedPoints.toLocaleString()}**`
					].join('\n'),
					inline: false
				},
				{
					name: selectedTier !== null ? 'Selected Tier' : 'Tier Payouts',
					value: tierFieldValue,
					inline: true
				},
				{
					name: 'Effective Utilization',
					value: `${dynamicMaxPossible ? ((totalFinalizedPoints / dynamicMaxPossible) * 100).toFixed(1) : '0'}%`,
					inline: true
				}
			);

		// Per-category breakdown
		for (const d of details) {
			embed.addFields({
				name: `${d.category} (${d.weightClass})`,
				value: `Raw: ${d.rawPoints.toLocaleString()}\nApplied: ${d.appliedPoints.toLocaleString()}\nWasted: ${d.wastedPoints.toLocaleString()}\nBudget: ${Math.round(d.bracketBudget).toLocaleString()}`,
				inline: true
			});
		}

		// If too many fields (Discord limit 25), we may need to chunk; simple safeguard
		if (embed.data.fields && embed.data.fields.length > 25) {
			// Trim detail fields if excessive
			embed.data.fields = embed.data.fields.slice(0, 25);
		}

		await interaction.editReply({ embeds: [embed] });
	}
}
