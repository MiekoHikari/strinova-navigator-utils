import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { container } from '@sapphire/framework';
import type { ButtonInteraction, ModalActionRowComponentBuilder, ForumChannel } from 'discord.js';
import { ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ChannelType } from 'discord.js';
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
				const resumeBtn = new ButtonBuilder()
					.setCustomId('report:resume')
					.setLabel('Resume')
					.setStyle(ButtonStyle.Primary);
				const cancelBtn = new ButtonBuilder()
					.setCustomId('report:cancel')
					.setLabel('Cancel Session')
					.setStyle(ButtonStyle.Danger);
				return interaction.reply({
					content: 'You already have a report in progress. You can resume where you left off or cancel it to start fresh.',
					components: [new ActionRowBuilder<ButtonBuilder>().addComponents(resumeBtn, cancelBtn)],
					ephemeral: true
				});
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
			// Deprecated path (legacy). Encourage restart.
			return interaction.reply({ content: 'Flow updated. Please start a new report.', ephemeral: true });
		}

		if (action === 'resume') {
			const session = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (!session) return interaction.reply({ content: 'No active session found (it may have expired). Start again.', ephemeral: true });
			// Branch based on progress
			const hasIdentity = Boolean(session.reportedPlayerId || session.reportedNickname);
			if (!hasIdentity) {
				// Re-show identity modal
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
			const hasTags = (session.forumTagIds || []).length > 0;
			if (!hasTags) {
				// Rebuild tag selection (same as identity step in modal handler)
				const forumChannelId = session.forumChannelId;
				const parentChannel = forumChannelId ? interaction.guild!.channels.cache.get(forumChannelId) : null;
				if (!parentChannel || parentChannel.type !== ChannelType.GuildForum) {
					return interaction.reply({ content: 'Forum context lost; cancel and restart.', ephemeral: true });
				}
				const forum = parentChannel as ForumChannel;
				const available = forum.availableTags.filter(t => !t.moderated);
				if (!available.length) return interaction.reply({ content: 'No forum tags configured. Contact staff.', ephemeral: true });
				const rows: ActionRowBuilder<ButtonBuilder>[] = [];
				for (let i = 0; i < available.length; i += 5) {
					rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
						...available.slice(i, i + 5).map(tag => new ButtonBuilder()
							.setCustomId(`report:tag:${tag.id}`)
							.setLabel(tag.name.slice(0, 20))
							.setStyle(ButtonStyle.Secondary))
					));
				}
				rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
					new ButtonBuilder().setCustomId('report:tag-done').setLabel('Done').setStyle(ButtonStyle.Primary),
					new ButtonBuilder().setCustomId('report:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
				));
				return interaction.reply({ content: 'Select the relevant tags then press Done.', components: rows, ephemeral: true });
			}

			// Proceed to details modal
			const detailsModal = new ModalBuilder().setCustomId('report:details').setTitle('Report - Additional Details');
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
				.setPlaceholder('Describe what happened.')
				.setMinLength(40);

			detailsModal.addComponents(
				new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(matchIdInput),
				new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(summaryInput)
			);
			await interaction.showModal(detailsModal);
			return;
		}

		// Tag toggle: action starts with 'tag'
		if (action === 'tag') {
			const tagId = interaction.customId.split(':')[2];
			const session = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (!session) return interaction.reply({ content: 'Session expired. Start again.', ephemeral: true });
			const has = (session.forumTagIds || []).includes(tagId);
			await PlayerReportModel.updateOne({ _id: session._id }, has ? { $pull: { forumTagIds: tagId } } : { $addToSet: { forumTagIds: tagId } });
			const updated = await PlayerReportModel.findById(session._id).lean();
			const forumChannelId = updated?.forumChannelId;
			const parentChannel = forumChannelId ? interaction.guild!.channels.cache.get(forumChannelId) : null;
			if (!parentChannel || parentChannel.type !== ChannelType.GuildForum) {
				return interaction.update({ content: 'Forum context lost. Cancel and restart.', components: [] });
			}
			const forum = parentChannel as ForumChannel;
			const available = forum.availableTags.filter(t => !t.moderated);
			const selected = new Set(updated?.forumTagIds || []);
			const rows: ActionRowBuilder<ButtonBuilder>[] = [];
			for (let i = 0; i < available.length; i += 5) {
				rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
					...available.slice(i, i + 5).map(tag => new ButtonBuilder()
						.setCustomId(`report:tag:${tag.id}`)
						.setLabel(tag.name.slice(0, 20))
						.setStyle(selected.has(tag.id) ? ButtonStyle.Success : ButtonStyle.Secondary))
				));
			}
			rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId('report:tag-done').setLabel('Done').setStyle(ButtonStyle.Primary).setDisabled(selected.size === 0),
				new ButtonBuilder().setCustomId('report:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
			));
			return interaction.update({
				content: `Select tags (selected: ${selected.size}). Press Done when finished.`,
				components: rows
			});
		}

		if (action === 'tag-done') {
			const session = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (!session) return interaction.reply({ content: 'Session expired. Start again.', ephemeral: true });
			if (!session.forumTagIds || session.forumTagIds.length === 0) {
				return interaction.reply({ content: 'Select at least one tag before continuing.', ephemeral: true });
			}
			// Build details modal (match + summary only)
			const detailsModal = new ModalBuilder().setCustomId('report:details').setTitle('Report - Additional Details');
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
