import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { container } from '@sapphire/framework';
import type { ForumChannel, ModalSubmitInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } from 'discord.js';
import { PlayerReportModel } from '#lib/db/models/PlayerReport';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.ModalSubmit
})
export class ModalHandler extends InteractionHandler {
	public async run(interaction: ModalSubmitInteraction, parsed: { step: 'identity' | 'details' }) {
		if (!interaction.guildId) return interaction.reply({ content: 'Guild context required.', ephemeral: true });

		if (parsed.step === 'identity') {
			const playerId = interaction.fields.getTextInputValue('reportedPlayerId')?.trim();
			const nickname = interaction.fields.getTextInputValue('reportedNickname')?.trim();
			if (!playerId && !nickname) {
				return interaction.reply({ content: 'You must provide at least a Player ID or a Nickname.', ephemeral: true });
			}

			// Load existing session
			const session = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (!session) {
				return interaction.reply({ content: 'No active report session found (it may have expired). Start again.', ephemeral: true });
			}

			// Update identity fields
			await PlayerReportModel.updateOne({ _id: session._id }, { $set: { reportedPlayerId: playerId || undefined, reportedNickname: nickname || undefined } });

			// Count prior submitted reports for this target
			let priorCount = 0;
			if (playerId) priorCount += await PlayerReportModel.countDocuments({ guildId: interaction.guildId, reportedPlayerId: playerId, status: 'SUBMITTED' });
			if (!playerId && nickname) priorCount += await PlayerReportModel.countDocuments({ guildId: interaction.guildId, reportedNickname: nickname, status: 'SUBMITTED' });

			// Build tag selection buttons from forum channel available tags
			const guild = interaction.guild!;
			const sessionReload = await PlayerReportModel.findById(session._id).lean();
			const parentId = sessionReload?.forumChannelId;
			const parentChannel = parentId ? guild.channels.cache.get(parentId) : null;
			if (!parentChannel || parentChannel.type !== ChannelType.GuildForum) {
				return interaction.reply({ content: 'Report must start from a forum channel with tags configured.', ephemeral: true });
			}
			const available = (parentChannel as ForumChannel).availableTags.filter(t => !t.moderated);
			if (!available.length) {
				return interaction.reply({ content: 'No forum tags configured for reports. Contact staff.', ephemeral: true });
			}
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
			return interaction.reply({
				content: priorCount > 0 ? `Target has ${priorCount} prior report(s). Select relevant tags then press Done.` : 'Identity captured. Select the relevant tags then press Done.',
				components: rows,
				ephemeral: true
			});
		}

		if (parsed.step === 'details') {
			const matchId = interaction.fields.getTextInputValue('matchId')?.trim();
			const summary = interaction.fields.getTextInputValue('summary')?.trim();
			if (!summary) return interaction.reply({ content: 'Summary required.', ephemeral: true });
			// Categories should have been selected earlier via buttons

			const session = await PlayerReportModel.findOne({ guildId: interaction.guildId, reporterId: interaction.user.id, status: 'IN_PROGRESS' });
			if (!session) return interaction.reply({ content: 'No active session found (it may have expired).', ephemeral: true });
			if (!session.forumTagIds || session.forumTagIds.length === 0) return interaction.reply({ content: 'No tags selected. Start over.', ephemeral: true });

			// Update session before creating thread
			await PlayerReportModel.updateOne({ _id: session._id }, { $set: { matchId: matchId || undefined, summary }, $unset: { expiresAt: 1 } });

			// Determine forum parent channel
			const guild = interaction.guild!;
			let forumChannelId = session.forumChannelId;
			
			if (!forumChannelId) {
				return interaction.reply({ content: 'Original channel context lost; cancel and restart the report.', ephemeral: true });
			}

			const parentChannel = guild.channels.cache.get(forumChannelId);
			if (!parentChannel || parentChannel.type !== ChannelType.GuildForum) {
				return interaction.reply({ content: 'Reporting can only be initiated from a forum channel.', ephemeral: true });
			}

			const targetLabel = session.reportedPlayerId || session.reportedNickname || 'Unknown Player';
			const threadName = `${targetLabel}`;
			let createdThreadId: string | undefined;
			let firstMessageId: string | undefined;
			
			try {
				const embed = new EmbedBuilder()
					.setDescription(summary)
					.addFields(
						{ name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
						{ name: 'Reported', value: targetLabel, inline: true },
						{ name: 'Tags', value: session.forumTagIds.map(id => (parentChannel as ForumChannel).availableTags.find(t => t.id === id)?.name || id).join(', ').substring(0, 1024) },
						...(matchId ? [{ name: 'Match ID', value: matchId, inline: true }] : [])
					)
					.setTimestamp(new Date());
				
				const thread = await (parentChannel as ForumChannel).threads.create({
					name: threadName.substring(0, 95),
					message: { embeds: [embed], content: `# ${targetLabel}` },
					reason: `Player report by ${interaction.user.tag} (${interaction.user.id})`,
					appliedTags: session.forumTagIds
				});

				createdThreadId = thread.id;
				firstMessageId = await thread.messages.fetch().then(msgs => msgs.first()?.id);
			} catch (err) {
				container.logger.error('Failed creating report thread', err);
				return interaction.reply({ content: 'Failed to create report thread. Please contact staff.', ephemeral: true });
			}

			await PlayerReportModel.updateOne({ _id: session._id }, { $set: { status: 'SUBMITTED', threadId: createdThreadId, initialThreadMessageId: firstMessageId } });

			return interaction.reply({ content: 'Your report has been submitted. A thread has been created for evidence. Thank you.', ephemeral: true });
		}

		return interaction.reply({ content: 'Unexpected state.', ephemeral: true });
	}

	public override parse(interaction: ModalSubmitInteraction) {
		if (interaction.customId === 'report:identity') return this.some({ step: 'identity' });
		if (interaction.customId === 'report:details') return this.some({ step: 'details' });
		return this.none();
	}
}
