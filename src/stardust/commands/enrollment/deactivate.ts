import { Result } from '@sapphire/framework';
import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder, userMention } from 'discord.js';
import { getUser, deactivateEnrollment } from '@modules/stardust/services/stardust';

async function command(interaction: ChatInputCommandInteraction) {
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

export default {
	sapphire: {
		name: 'deactivate',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('deactivate')
		.setDescription('Deactivate an enrollment')
		.addUserOption((o) => o.setName('user').setDescription('User to deactivate').setRequired(true))
} as pluginCommand;
