import { GiveawayCollection } from '@prisma/client';
import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { prisma } from '_core/lib/prisma';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageActionRowComponentBuilder, type ButtonInteraction } from 'discord.js';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button,
	name: 'giveaway-button-handler'
})
export class ButtonHandler extends InteractionHandler {
	public async run(interaction: ButtonInteraction, collection: GiveawayCollection) {
		if (collection.endedAt)
			return interaction.reply({
				content: 'This giveaway collection has already ended.',
				flags: ['Ephemeral']
			});

		const collectionUser = await prisma.giveawayWinner.findFirst({
			where: {
				collectionId: collection.id,
				discordUserId: interaction.user.id
			}
		});

		if (!collectionUser)
			return interaction.reply({
				content: 'You are not listed as a winner for this giveaway collection.',
				flags: ['Ephemeral']
			});

		const instructionsEmbed = new EmbedBuilder()
			.setColor('Orange')
			.setDescription(
				`# Event Prize Claim Instructions!\n` +
					`To claim your prize of "${collection.prize}", please follow these steps:\n` +
					`1. Launch the game and open the friends menu\n` +
					`2. Copy your in-game UID as shown in the screenshot below\n` +
					`3. Press the button below to access the prize claim form\n` +
					`4. Submit your UID and please wait up to 14 business days after the collection deadline for the prize to be delivered via in-game mail.\n\n` +
					`If you have any questions or need further assistance, feel free to reach out to the moderation team. <:NovaALO:1266394121124188271>`
			)
			.setImage('https://i.imgur.com/SnWIBVd.png')
			.setFooter({ text: 'Strinova Navigator Giveaway System' })
			.setTimestamp();

		const claimButton = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
			new ButtonBuilder().setLabel('Open Form').setStyle(ButtonStyle.Primary).setCustomId(`giveaway-submit:${collection.id}`)
		);

		await interaction.reply({ embeds: [instructionsEmbed], components: [claimButton], flags: ['Ephemeral'] });

		return;
	}

	public override async parse(interaction: ButtonInteraction) {
		if (!interaction.customId.startsWith('giveaway')) return this.none();

		const collection = await prisma.giveawayCollection.findFirst({
			where: { messageId: interaction.message.id }
		});

		if (!collection) return this.none();

		return this.some(collection);
	}
}
