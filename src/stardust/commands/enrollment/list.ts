import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import { getModeratorsList } from '../../services/stardust/profile.service';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const moderators = await getModeratorsList();
	if (moderators.length === 0) return interaction.editReply({ content: 'No active enrolled moderators.' });

	const members = moderators.map((mod) => `\`\`\`Username: ${mod.user.username}\n Enrolled At: ${mod.enrolledAt}\n User ID: ${mod.id}\`\`\``);

	return interaction.editReply({ content: `**Active Enrolled Moderators (${moderators.length}):**\n\n${members.join('\n')}` });
}

export default {
	sapphire: {
		name: 'list',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder().setName('list').setDescription('List currently active enrolled moderators')
} as pluginCommand;
