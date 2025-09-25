import { ModmailApprovalRequestModel, type ModmailApprovalRequestDocument } from '#lib/db/models/ModmailApprovalRequest';
import { ModmailThreadClosureModel } from '#lib/db/models/ModmailThreadClosure';
import { generateRequestButtons } from '#lib/modmailManager';
import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import {
	ActionRowBuilder,
	EmbedBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	type ButtonInteraction,
	type ColorResolvable,
	type MessageActionRowComponentBuilder
} from 'discord.js';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button
})
export class ButtonHandler extends InteractionHandler {
	private async approveRequest(interaction: ButtonInteraction, request: ModmailApprovalRequestDocument) {
		return this.finalizeRequest(interaction, request, 'APPROVED', 'This closure was approved.', '#2ecc71');
	}

	private async denyRequest(interaction: ButtonInteraction, request: ModmailApprovalRequestDocument) {
		return this.finalizeRequest(interaction, request, 'DENIED', 'This closure was denied.', '#e74c3c');
	}

	private async changeRequest(interaction: ButtonInteraction, request: ModmailApprovalRequestDocument) {
		// Present a modal to specify a new main contributor user ID
		const modal = new ModalBuilder().setCustomId(`modmail-change-contributor:${request.requestId}`).setTitle('Change Main Contributor');

		const userIdInput = new TextInputBuilder()
			.setCustomId('userId')
			.setLabel('Contributor User ID')
			.setPlaceholder('Enter the Discord user ID of the main contributor')
			.setStyle(TextInputStyle.Short)
			.setRequired(true);

		const row = new ActionRowBuilder<TextInputBuilder>().addComponents(userIdInput);
		modal.addComponents(row);
		await interaction.showModal(modal);
	}

	private async finalizeRequest(
		interaction: ButtonInteraction,
		request: ModmailApprovalRequestDocument,
		resolution: 'APPROVED' | 'DENIED' | 'FALLBACK',
		footerMessage: string,
		color: ColorResolvable
	) {
		if (request.resolved) {
			return interaction.reply({ content: `This request has already been resolved as ${request.resolution}.`, ephemeral: true });
		}

		// Atomically mark resolved
		const updated = await ModmailApprovalRequestModel.findOneAndUpdate(
			{ _id: request._id, resolved: false },
			{
				$set: {
					resolved: true,
					resolvedAt: new Date(),
					resolution,
					resolvedById: interaction.user.id
				}
			},
			{ new: true }
		);
		if (!updated) {
			return interaction.reply({ content: 'Request was already handled by someone else.', ephemeral: true });
		}

		// Update related ModmailThreadClosure if approving
		if (resolution === 'APPROVED') {
			await ModmailThreadClosureModel.updateOne(
				{ messageId: updated.closureMessageId },
				{
					$set: {
						approved: true,
						approvedById: interaction.user.id,
						approvedAt: new Date(),
						pointsAwardedToId: request.mainContributorId
					}
				}
			).catch(() => null);
		}

		// Edit original approval message embed
		const base = EmbedBuilder.from(interaction.message.embeds[0]);
		base.setFooter({ text: footerMessage }).setColor(color);

		const messageUrl = base?.data.description?.match(/\(https:\/\/discord\.com\/channels\/.+?\)/)?.[0]?.slice(1, -1) || 'Unknown';

		// Append resolution line
		base.addFields({ name: 'Resolution', value: `${resolution} by <@${interaction.user.id}> (${interaction.user.id})` });

		const buttons = generateRequestButtons(updated.requestId, messageUrl, true);
		const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().setComponents(buttons);

		await interaction.message.edit({ embeds: [base], components: [row] }).catch(() => null);

		return interaction.reply({ content: `Request ${resolution.toLowerCase()} successfully.`, ephemeral: true });
	}

	public async run(interaction: ButtonInteraction, parsedData: InteractionHandler.ParseResult<this>) {
		const { command, requestModel } = parsedData as any;
		if (!requestModel) {
			return interaction.reply({ content: 'No approval request found for this ID.', ephemeral: true });
		}
		switch (command) {
			case 'approve':
				return this.approveRequest(interaction, requestModel);
			case 'deny':
				return this.denyRequest(interaction, requestModel);
			case 'change':
				return this.changeRequest(interaction, requestModel);
			default:
				return interaction.reply({ content: 'Unknown command.', ephemeral: true });
		}
	}

	public override async parse(interaction: ButtonInteraction) {
		const [action, command, id] = interaction.customId.split(':');
		if (action !== 'modmail') return this.none();
		const requestModel = await ModmailApprovalRequestModel.findOne({ requestId: id });
		return this.some({ command, requestModel });
	}
}
