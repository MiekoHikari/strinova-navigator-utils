import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { ensureUser, getCurrentMonthPoints, getModeratorProfile } from '@modules/stardust/services/stardust';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const user = interaction.options.getUser('user', true);
	await ensureUser(user.id, user.username);

	const moderatorProfile = await getModeratorProfile(user.id);

	const currentMonthPoints = await getCurrentMonthPoints(user.id, new Date().getMonth() + 1, new Date().getFullYear());

	const profileEmbed = new EmbedBuilder()
		.setAuthor({ name: `Moderator Stardust Profile` })
		.setDescription(
			`
		# Stardust Profile\
		\n-----------\
		\n### User Information\
		\n> **User:** @${moderatorProfile.user.username}\
		\n> **User ID:** ${moderatorProfile.user.id}\
		\n> **Current Reward Tier:** ${moderatorProfile.tier}\
		\n\
		\n### Moderator Profile\
		\n> **Enrolled At:** ${moderatorProfile.enrolledAt.toDateString()}\
		\n> **Active Enrollment:** ${moderatorProfile.active ? 'Yes' : 'No'}\
		\n> **Total Mod Actions:** ${moderatorProfile.modActions.length}\
		\n> **Weeks Participated:** ${moderatorProfile.weeklyStats.length}\
		\n> **Current Month Points:** ${currentMonthPoints}\
		\n\
		\n### Recent Weeks Stats\
		\n${moderatorProfile.weeklyStats
			.sort((a, b) => b.year - a.year || b.week - a.week)
			.slice(0, 5)
			.map((week) => `> **Week ${week.week}, ${week.year}:** ${week.totalPoints} points`)
			.join('\n')}
	`
		)
		.setColor('#0099ff')
		.setThumbnail(user.displayAvatarURL())
		.setTimestamp();

	return interaction.editReply({ embeds: [profileEmbed] });
}

export default {
	sapphire: {
		name: 'profile',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('profile')
		.setDescription('View a moderator stardust profile.')
		.addUserOption((o) => o.setName('user').setDescription('The moderator you want to view').setRequired(true))
} as pluginCommand;
