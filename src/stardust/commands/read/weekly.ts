import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { ensureUser } from '../../services/stardust/profile.service';
import { getWeeklyRecords } from '../../services/stardust/reporting.service';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const user = interaction.options.getUser('user', true);
	const week = interaction.options.getInteger('week', true);
	const year = interaction.options.getInteger('year', true);

	await ensureUser(user.id, user.username);

	const moderatorWeeklyStat = await getWeeklyRecords(user.id, week, year);

	const weeklyEmbed = new EmbedBuilder()
		.setAuthor({ name: `Moderator Weekly Stat` })
		.setDescription(
			`
		# Stardust Profile\
		\n-----------\
		\n### User Information\
		\n> **User:** @${moderatorWeeklyStat.moderator.user.username}\
		\n> **User ID:** ${moderatorWeeklyStat.moderator.user.id}\
		\n> **Current Reward Tier:** ${moderatorWeeklyStat.moderator.tier}
		\n\
		\n### Points Information\
		\n> **Week Raw Points:** ${moderatorWeeklyStat.rawPoints}\
		\n> **Week Final Points:** ${moderatorWeeklyStat.totalPoints}\
		\n> **Week Wasted Points:** ${moderatorWeeklyStat.rawPoints - moderatorWeeklyStat.totalPoints}\
		\n\
		\n### Week Stats\
		\n> **Mod Chat Messages:** ${moderatorWeeklyStat.modChatMessages}\
		\n> **Public Chat Messages:** ${moderatorWeeklyStat.publicChatMessages}\
		\n> **Voice Chat Minutes:** ${moderatorWeeklyStat.voiceChatMinutes}\
		\n> **Mod Actions Count:** ${moderatorWeeklyStat.modActionsCount}\
		\n> **Cases Handled:** ${moderatorWeeklyStat.casesHandledCount}\
		\n> **Total Points This Week:** ${moderatorWeeklyStat.totalPoints}`
		)
		.setColor('#0099ff')
		.setThumbnail(user.displayAvatarURL())
		.setTimestamp();

	return interaction.editReply({ embeds: [weeklyEmbed] });
}

export default {
	sapphire: {
		name: 'weekly',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('weekly')
		.setDescription('Read a weekly report')
		.addUserOption((o) => o.setName('user').setDescription('The moderator you want to view').setRequired(true))
		.addIntegerOption((o) => o.setName('week').setDescription('Week number (1-53)').setRequired(true).setMinValue(1).setMaxValue(53))
		.addIntegerOption((o) => o.setName('year').setDescription('Year').setRequired(true).setMinValue(2024).setMaxValue(2030))
} as pluginCommand;
