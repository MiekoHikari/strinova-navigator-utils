import { pluginCommand } from '_core/sapphire';
import { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });
}

export default {
	sapphire: {
		name: 'end',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('end')
		.setDescription('End an existing giveaway collection')
		.addStringOption((option) => option.setName('message-id').setDescription('The ID of the collection message').setRequired(true))
} as pluginCommand;
