import { ChatInputCommandInteraction, Role, SlashCommandSubcommandBuilder, User, userMention } from 'discord.js';
import { ChatInputCommandContext, Result } from '@sapphire/framework';
import { pluginCommand } from '../../../_core/sapphire';
import { activateEnrollment, ensureUser } from '../../services/stardust/profile.service';

async function command(interaction: ChatInputCommandInteraction, _context: ChatInputCommandContext) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const batchRole = interaction.options.getRole('batch', false) as Role | null;
	const target = interaction.options.getUser('user', false);

	if (batchRole && target) {
		return interaction.editReply({ content: 'Please specify either a user or a batch role, not both.' });
	} else if (target) {
		return interaction.editReply(await activateUser(target));
	} else if (batchRole) {
		return interaction.editReply(await activateBatch(batchRole));
	} else {
		return interaction.editReply({ content: 'Please specify either a user or a batch role to activate.' });
	}
}

async function activateUser(target: User) {
	const userId = target.id;
	const username = target.username;

	const profile = await ensureUser(userId, username);

	const result = await Result.fromAsync(() => activateEnrollment(userId));

	if (result.isErr()) {
		throw new Error(`Failed to activate enrollment for ${username} (${userId}): ${result.unwrapErr()}`);
	}

	if (profile.createdAt === profile.updatedAt) {
		return { content: `${userMention(userId)} has been enrolled in the Stardust Program! Welcome aboard!` };
	} else {
		return { content: `${userMention(userId)}'s enrollment in the Stardust Program has been re-activated!` };
	}
}

async function activateBatch(batchRole: Role) {
	const members = batchRole.members;

	const messages = [];

	for (const [userId, member] of members) {
		const user = member.user;

		try {
			const msg = await activateUser(user);

			messages.push(msg.content);
		} catch (error) {
			messages.push(`Failed to activate ${user.username} (${userId}): ${error}`);
			continue;
		}
	}

	return { content: messages.join('\n') };
}

export default {
	sapphire: {
		name: 'activate',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('activate')
		.setDescription('Activate (or create) an enrollment')
		.addUserOption((o) => o.setName('user').setDescription('User to activate').setRequired(false))
		.addRoleOption((o) => o.setName('batch').setDescription('Automatic Batch role activation').setRequired(false))
} as pluginCommand;
