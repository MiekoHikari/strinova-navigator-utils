import { prisma } from '_core/lib/prisma';
import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const mods = await prisma.moderatorProfile.findMany({
		include: { user: true },
		orderBy: { tier: 'desc' }
	});

	const tierList = mods.map((mod) => `**${mod.user.username}** - Tier ${mod.tier}`).join('\n');

	await interaction.editReply({
		content: `### Moderator Tiers:\n${tierList}`
	});
}

export default {
	sapphire: {
		name: 'list',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder().setName('list').setDescription('List all mods and their current tiers.')
} as pluginCommand;
