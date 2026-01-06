import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { prisma } from '_core/lib/prisma';
import { ModalSubmitInteraction } from 'discord.js';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
	name: 'giveaway-modal-handler'
})
export class ModalHandler extends InteractionHandler {
	public async run(interaction: ModalSubmitInteraction, options: { collectionId: string; uid: string }) {
		await interaction.deferReply({ flags: ['Ephemeral'] });

		const collection = await prisma.giveawayCollection.findUnique({
			where: { id: options.collectionId },
			include: { giveawayWinners: true }
		});

		if (!collection) {
			await interaction.editReply('❌ Collection not found.');
			return;
		}

		const winnerProfile = await prisma.giveawayWinner.findFirst({
			where: {
				discordUserId: interaction.user.id,
				collectionId: collection.id
			}
		});

		if (!winnerProfile) {
			await interaction.editReply('❌ You are not registered as a winner for this collection.');
			return;
		}

		await prisma.giveawayWinner.update({
			where: { id: winnerProfile.id },
			data: { userId: options.uid }
		});

		await interaction.editReply('✅ Your event claim has been recorded successfully!');

		return 0;
	}

	public override async parse(interaction: ModalSubmitInteraction) {
		if (!interaction.customId.startsWith('giveaway-claim')) return this.none();

		const collectionId = interaction.customId.split(':')[1];

		// Extract UID
		const uid = interaction.fields.getTextInputValue('bablo-uid');

		return this.some({ collectionId, uid });
	}
}
