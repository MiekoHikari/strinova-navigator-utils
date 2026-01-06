import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { ButtonInteraction, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button,
	name: 'giveaway-submission-handler'
})
export class ModalHandler extends InteractionHandler {
	public async run(interaction: ButtonInteraction) {
		const babloLabel = new LabelBuilder()
			.setLabel('In-Game UID')
			.setDescription('Please follow the instructions shown in the previous screen to get your UID.')
			.setTextInputComponent(new TextInputBuilder().setCustomId('bablo-uid').setStyle(TextInputStyle.Short).setRequired(true));

		const Modal = new ModalBuilder()
			.setLabelComponents([babloLabel])
			.setTitle('Giveaway Prize Claim Form')
			.setCustomId(`giveaway-claim:${interaction.customId.split(':')[1]}`);

		await interaction.showModal(Modal);

		return;
	}

	public override async parse(interaction: ButtonInteraction) {
		if (!interaction.customId.startsWith('giveaway-submit')) return this.none();

		const collectionId = interaction.customId.split(':')[1];

		return this.some(collectionId);
	}
}
