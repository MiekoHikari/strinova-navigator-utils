import { computeWeightedPoints } from '../../lib/points';
import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const modChat = interaction.options.getInteger('mod-chat') ?? 0;
	const publicChat = interaction.options.getInteger('public-chat') ?? 0;
	const voiceMinutes = interaction.options.getInteger('voice-minutes') ?? 0;
	const modActions = interaction.options.getInteger('mod-actions') ?? 0;
	const cases = interaction.options.getInteger('cases') ?? 0;

	const points = computeWeightedPoints({
		modChatMessages: modChat,
		publicChatMessages: publicChat,
		voiceChatMinutes: voiceMinutes,
		modActionsTaken: modActions,
		casesHandled: cases
	});

	const wastedPoints = points.totalRawPoints - points.totalFinalizedPoints;

	const calculatorEmbed = new EmbedBuilder()
		.setAuthor({ name: `Stardust Points Calculator` })
		.setDescription(
			`
            # Stardust Points Calculation\
            \n-----------\
            \n### Input Stats\
            \n> **Moderator Chat Messages:** ${modChat}\
            \n> **Public Chat Messages:** ${publicChat}\
            \n> **Voice Chat Minutes:** ${voiceMinutes}\
            \n> **Moderation Actions Taken:** ${modActions}\
            \n> **Approved Modmail Cases Handled:** ${cases}\
            \n\
            \n### Calculated Points\
            \n> **Total Raw Points:** ${points.totalRawPoints}\
            \n> **Total Finalized Points:** ${points.totalFinalizedPoints}\
            \n> **Total Wasted Points:** ${wastedPoints}\
            `
		)
		.setColor('#00ff99')
		.setTimestamp();

	await interaction.editReply({ embeds: [calculatorEmbed] });
}

export default {
	sapphire: {
		name: 'calculator',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('calculator')
		.setDescription('Calculate projected stardust points, wasted points, and tier outcomes.')
		.addIntegerOption((opt) => opt.setName('mod-chat').setDescription('Moderator chat messages').setMinValue(0).setMaxValue(100_000))
		.addIntegerOption((opt) => opt.setName('public-chat').setDescription('Public chat messages').setMinValue(0).setMaxValue(100_000))
		.addIntegerOption((opt) => opt.setName('voice-minutes').setDescription('Voice minutes').setMinValue(0).setMaxValue(100_000))
		.addIntegerOption((opt) =>
			opt.setName('mod-actions').setDescription('Moderation actions (BAN/WARN/MUTE/KICK)').setMinValue(0).setMaxValue(10_000)
		)
		.addIntegerOption((opt) => opt.setName('cases').setDescription('Approved modmail cases handled').setMinValue(0).setMaxValue(10_000))
} as pluginCommand;
