import { ModmailApprovalRequestModel } from '#lib/db/models/ModmailApprovalRequest';
import { ModmailThreadClosureModel } from '#lib/db/models/ModmailThreadClosure';
import { generateRequestButtons } from '#lib/modmailManager';
import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import type { ModalSubmitInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.ModalSubmit
})
export class ModalHandler extends InteractionHandler {
	public async run(interaction: ModalSubmitInteraction) {
		const [modalAction, requestId] = interaction.customId.split(':').slice(0, 2);
		if (modalAction !== 'modmail-change-contributor') return;

		// Basic mod permission check (Manage Messages or Mod role presence)
		const member =
			interaction.guild?.members.cache.get(interaction.user.id) ||
			(interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null);
		if (!member) return interaction.reply({ content: 'Could not resolve your member object.', ephemeral: true });
		if (!member.permissions.has('ManageMessages')) {
			return interaction.reply({ content: 'You lack permission to perform this action.', ephemeral: true });
		}

		const userId = interaction.fields.getTextInputValue('userId').trim();
		if (!/^\d{15,20}$/.test(userId)) {
			return interaction.reply({ content: 'Invalid user ID format.', ephemeral: true });
		}

		const request = await ModmailApprovalRequestModel.findOne({ requestId });
		if (!request) return interaction.reply({ content: 'Approval request not found.', ephemeral: true });
		if (request.resolved) return interaction.reply({ content: 'This request has already been resolved.', ephemeral: true });

		// Mark as fallback (change) resolution but store pointsAwardedToId on closure record
		request.resolved = true;
		request.resolvedAt = new Date();
		request.resolution = 'FALLBACK';
		request.resolvedById = interaction.user.id;
		request.mainContributorId = userId;

		await request.save();

		await ModmailThreadClosureModel.updateOne(
			{ messageId: request.closureMessageId },
			{ $set: { pointsAwardedToId: userId, approved: true, approvedById: interaction.user.id, approvedAt: new Date() } }
		);

		// Edit the original approval message (find message via interaction.message? Not accessible here) - best effort if interaction was from that message
		const parentMessage = interaction.message;
		if (parentMessage && parentMessage.editable) {
			// Edit original approval message embed
			const base = EmbedBuilder.from(parentMessage.embeds[0]);
			base.setFooter({ text: 'Contributor changed via modal' }).setColor('#f1c40f');

			const messageUrl = base?.data.description?.match(/\(https:\/\/discord\.com\/channels\/.+?\)/)?.[0]?.slice(1, -1) || 'Unknown';
			base.addFields({ name: 'Resolution', value: `FALLBACK by <@${interaction.user.id}> (${interaction.user.id})` });

			// Rebuild disabled buttons set
			const buttons = generateRequestButtons(requestId, messageUrl, true);
			const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];

			await parentMessage.edit({ embeds: [base], components: rows });
		}

		return interaction.reply({ content: `Main contributor set to <@${userId}> (${userId}).`, ephemeral: true });
	}

	public override parse(interaction: ModalSubmitInteraction) {
		if (!interaction.customId.startsWith('modmail-change-contributor:')) return this.none();
		return this.some({});
	}
}
