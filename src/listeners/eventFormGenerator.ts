import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageActionRowComponentBuilder } from 'discord.js';

@ApplyOptions<Listener.Options>({
	event: Events.InteractionCreate
})
export class UserEvent extends Listener {
	public override async run(interaction: ButtonInteraction) {
		if (!interaction.isButton()) return;

		const [customId, eventName] = interaction.customId.split('^');
		if (customId !== 'winnerForm') return;

		const eventNameFormatted = eventName.split('_').join(' ');
		const urlEventName = encodeURIComponent(eventNameFormatted);

		const formlink = `https://docs.google.com/forms/d/e/1FAIpQLSc1TQClfOibUQqgO-cDHRTq27_jdv7oKjO4U0z6EUKMrYL_Yw/viewform?usp=pp_url&entry.1934857044=${urlEventName}&entry.1226131736=${interaction.user.username}`;

		const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
			new ButtonBuilder()
				.setLabel('Winner Form Link')
				.setStyle(ButtonStyle.Link) // Link button style
				.setURL(formlink)
				.setEmoji('📄')
		);

		return await interaction.reply({
			content: `A link has been generated!\n\nIf you have troubles clicking the button, click this link: <${formlink}>`,
			components: [row],
			flags: ['Ephemeral']
		});
	}
}
