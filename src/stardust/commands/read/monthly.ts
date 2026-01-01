import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { getMonthlyReport } from 'stardust/services/stardust.service';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const month = interaction.options.getInteger('month', true);
	const year = interaction.options.getInteger('year', true);

	const { totalStats, stats } = await getMonthlyReport(month, year);

	const monthlyEmbed = new EmbedBuilder()
		.setAuthor({ name: `Moderator Monthly Report` })
		.setDescription(
			`
			# Stardust Monthly Leaderboard\
			\n-----------\
			\n### Report Information\
			\n> **Month:** ${month}\
			\n> **Year:** ${year}\
			\n> **Total Records:** ${stats.length}
			\n\
			\n### Overall Stats\
			\n> **Total Raw Points:** ${totalStats.rawPoints}\
			\n> **Total Finalized Points:** ${totalStats.finalPoints}\
			\n> **Total Wasted Points:** ${totalStats.wastedPoints}\
			\n> **Total Mod Chat Messages:** ${totalStats.modChatMessages}\
			\n> **Total Public Chat Messages:** ${totalStats.publicChatMessages}\
			\n> **Total Voice Chat Minutes:** ${totalStats.voiceChatMinutes}\
			\n> **Total Mod Actions Taken:** ${totalStats.modActionsCount}\
			\n> **Total Cases Handled:** ${totalStats.casesHandledCount}\
			\n\
			\n### Top 10 Stats\
			${stats
				.slice(0, 10)
				.map((stat, i) => `\n> **${i + 1}.** <@${stat.moderatorId}>: ${stat.totalPoints} pts`)
				.join('')}`
		)
		.setColor('#0099ff')
		.setTimestamp();

	await interaction.editReply({ embeds: [monthlyEmbed] });
}

export default {
	sapphire: {
		name: 'monthly',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('monthly')
		.setDescription('Generate (or force-regenerate) the monthly leaderboard report.')
		.addIntegerOption((o) => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
		.addIntegerOption((o) => o.setName('year').setDescription('Year').setRequired(true).setMinValue(2024).setMaxValue(2030))
} as pluginCommand;
