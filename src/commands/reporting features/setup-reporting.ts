import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageActionRowComponentBuilder } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'setup-reporting',
	description: 'Setup player reporting in the server',
	requiredUserPermissions: ['ManageGuild'],
	runIn: ['GUILD_ANY']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addChannelOption((option) =>
					option //
						.setName('channel')
						.setDescription('The channel to setup reporting')
						.setRequired(true)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const channel = await interaction.guild?.channels.fetch(interaction.options.getChannel('channel', true).id);
		if (!channel) return interaction.reply({ content: 'The specified channel does not exist.', ephemeral: true });
		if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });

		if (channel.type !== ChannelType.GuildForum) return interaction.reply({ content: 'The channel must be a forum channel.', ephemeral: true });

		const reportEmbed = new EmbedBuilder()
			.setDescription('# Report In-Game Violations Here!\nHello Navigators! \n\nThis channel is used to provide further evidence and information regarding in-game violations. Please ensure that you include as much detail as possible to help us address the issue effectively.\n\n**Guidelines for Reporting:**\n1. **Be Specific:** Clearly describe the violation, including dates, times, and any relevant context.\n2. **Provide Evidence:** Attach screenshots, videos, or any other evidence that supports your report.\n3. **Stay Respectful:** Maintain a respectful tone in your reports. We are here to help!\n\nThank you for helping us keep our community safe and enjoyable for everyone!')
			.setColor("#ff7800")

		const reportButton = new ActionRowBuilder<MessageActionRowComponentBuilder>()
			.addComponents(
				new ButtonBuilder()
					.setCustomId('report:create')
					.setLabel('Create Report')
					.setStyle(ButtonStyle.Danger)
			)

		const thread = await channel.threads.create({
			name: 'Report Players Here!',
			reason: 'Setting up player reporting',
			message: {
				embeds: [reportEmbed],
				components: [reportButton]
			},
		});

		await thread.setLocked(true);

		return interaction.reply({ content: 'Hello world!' });
	}
}
