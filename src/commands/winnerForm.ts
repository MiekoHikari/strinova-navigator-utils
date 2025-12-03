import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageActionRowComponentBuilder } from 'discord.js';

@ApplyOptions<Command.Options>({
	description: 'Generate a form for the winners',
	requiredUserPermissions: ['ManageRoles']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addStringOption((option) => option.setName('event-name').setDescription('The name of the event').setRequired(true))
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		const eventName = interaction.options.getString('event-name', true);

		if (!interaction.channel?.isSendable) return;

		const embed = new EmbedBuilder()
			.setDescription(`# **Congratulations to the winners of ${eventName}!** 🎉\n\nPlease fill out the form below to claim your prize.`)
			.setTimestamp()
			.setColor('Random');

		const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`winnerForm^${eventName.split(' ').join('_')}`)
				.setLabel('Generate Link')
				.setStyle(ButtonStyle.Primary)
		);

		if (interaction.channel && interaction.channel.isTextBased() && interaction.channel.isSendable()) {
			await interaction.channel.send({ embeds: [embed], components: [row] });
			await interaction.reply({ content: 'Winner form has been posted!', ephemeral: true });
		}
	}
}
