import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder, userMention } from 'discord.js';
import { ChatInputCommandContext, Result } from '@sapphire/framework';
import { pluginCommand } from '../../../_core/sapphire';
import { activateEnrollment, ensureUser } from 'stardust/services/stardust.service';

async function command(interaction: ChatInputCommandInteraction, _context: ChatInputCommandContext) {
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

export default {
	sapphire: {
		name: 'activate',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('activate')
		.setDescription('Activate (or create) an enrollment')
		.addUserOption((o) => o.setName('user').setDescription('User to activate').setRequired(true))
} as pluginCommand;
