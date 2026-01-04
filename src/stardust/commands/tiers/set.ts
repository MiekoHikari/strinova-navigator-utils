import { prisma } from '_core/lib/prisma';
import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	const user = interaction.options.getUser('moderator', true);
	const tier = interaction.options.getInteger('tier', true);

	const modProfile = await prisma.moderatorProfile.findUnique({
		where: { id: user.id }
	});

	if (!modProfile) {
		await interaction.editReply({ content: `Moderator profile for ${user.username} not found.` });
		return;
	}

	await prisma.moderatorProfile.update({
		where: { id: user.id },
		data: { tier }
	});

	await interaction.editReply({ content: `Set tier of ${user.username} to Tier ${tier}.` });
}

export default {
	sapphire: {
		name: 'set',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('set')
		.setDescription("Set a mod's tier.")
		.addIntegerOption((opt) => opt.setName('tier').setDescription('Tier to set (0-3)').setMinValue(0).setMaxValue(3).setRequired(true))
		.addUserOption((opt) => opt.setName('moderator').setDescription('Moderator to set the tier for').setRequired(true))
} as pluginCommand;
