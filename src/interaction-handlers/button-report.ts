import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { container } from '@sapphire/framework';
import type { ButtonInteraction, ModalActionRowComponentBuilder } from 'discord.js';
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { PlayerReportModel } from '#lib/db/models/PlayerReport';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button
})
export class ButtonHandler extends InteractionHandler {
	public async run(interaction: ButtonInteraction, { action }: { action: string; args: string[] }) {
		if (!interaction.guildId) return interaction.reply({ content: 'Guild context required.', ephemeral: true });

		if (action === 'create') {
			// Ensure no existing active session
			const existing = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (existing) {
				return interaction.reply({ content: 'You already have a report in progress. Submit or cancel it before starting a new one.', ephemeral: true });
			}

			// Create an IN_PROGRESS session placeholder with 30 min expiry
			await PlayerReportModel.create({
				guildId: interaction.guildId,
				reporterId: interaction.user.id,
				status: 'IN_PROGRESS',
				forumChannelId: interaction.channel?.isThread() ? interaction.channel.parentId : interaction.channelId,
				expiresAt: new Date(Date.now() + 30 * 60 * 1000)
			});

			// Present identity capture modal
			const modal = new ModalBuilder()
				.setCustomId('report:identity')
				.setTitle('Report - Player Identity');

			const playerIdInput = new TextInputBuilder()
				.setCustomId('reportedPlayerId')
				.setLabel('Player ID (optional)')
				.setRequired(false)
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('e.g. 123456 / leave empty if unknown');

			const nicknameInput = new TextInputBuilder()
				.setCustomId('reportedNickname')
				.setLabel('Nickname (optional)')
				.setRequired(false)
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('At least one field must be filled overall');

			modal.addComponents(
				new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(playerIdInput),
				new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(nicknameInput)
			);

			await interaction.showModal(modal);
			return;
		}

		if (action === 'cancel') {
			const session = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (!session) return interaction.reply({ content: 'You have no active report session to cancel.', ephemeral: true });
			await PlayerReportModel.updateOne({ _id: session._id }, { $set: { status: 'CANCELLED' }, $unset: { expiresAt: 1 } });
			return interaction.reply({ content: 'Your report creation has been cancelled.', ephemeral: true });
		}

		if (action === 'continue-details') {
			const session = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (!session) return interaction.reply({ content: 'No active session found (it may have expired).', ephemeral: true });
			// Build details modal
			const detailsModal = new ModalBuilder().setCustomId('report:details').setTitle('Report - Details');
			const categoriesInput = new TextInputBuilder()
				.setCustomId('categories')
				.setLabel('Categories')
				.setStyle(TextInputStyle.Short)
				.setRequired(true)
				.setPlaceholder('Comma separated (e.g. HACKING, SABOTAGE)');
			const matchIdInput = new TextInputBuilder()
				.setCustomId('matchId')
				.setLabel('Match ID (if applicable)')
				.setStyle(TextInputStyle.Short)
				.setRequired(false);
			const summaryInput = new TextInputBuilder()
				.setCustomId('summary')
				.setLabel('Summary / Context')
				.setStyle(TextInputStyle.Paragraph)
				.setRequired(true)
				.setPlaceholder('Describe what happened.');
			detailsModal.addComponents(
				new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(categoriesInput),
				new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(matchIdInput),
				new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(summaryInput)
			);
			await interaction.showModal(detailsModal);
			return;
		}

		container.logger.warn(`Unknown report button action: ${action}`);
		return interaction.reply({ content: 'Unknown action.', ephemeral: true });
	}

	public override parse(interaction: ButtonInteraction) {
		const [command, action, ...args] = interaction.customId.split(':');
		if (command !== 'report') return this.none();

		return this.some({action, args});
	}
}
