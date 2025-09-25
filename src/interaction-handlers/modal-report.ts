import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import { container } from '@sapphire/framework';
import type { ModalSubmitInteraction } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { PlayerReportModel, PLAYER_REPORT_CATEGORIES } from '#lib/db/models/PlayerReport';

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


			// Build category selection rows (Discord allows max 5 buttons per row). We'll chunk categories.
			const rows: ActionRowBuilder<ButtonBuilder>[] = [];
			for (let i = 0; i < PLAYER_REPORT_CATEGORIES.length; i += 5) {
				const slice = PLAYER_REPORT_CATEGORIES.slice(i, i + 5);
				rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
					...slice.map(c => new ButtonBuilder()
						.setCustomId(`report:cat:${c}`)
						.setLabel(c.replace(/_/g, ' ').slice(0, 20))
						.setStyle(ButtonStyle.Secondary))
				));
			}
			// Control row with Done / Cancel
			rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId('report:cat-done').setLabel('Done').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId('report:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
			));

			return interaction.reply({
				content: priorCount > 0 ? `Target has ${priorCount} prior report(s). Select categories then press Done.` : 'Identity captured. Select one or more categories then press Done.',
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
			if (!session.categories || session.categories.length === 0) return interaction.reply({ content: 'No categories selected. Start over.', ephemeral: true });

			// Update session before creating thread
			await PlayerReportModel.updateOne({ _id: session._id }, { $set: { matchId: matchId || undefined, summary }, $unset: { expiresAt: 1 } });

			// Determine forum parent channel
			const guild = interaction.guild!;
			let forumChannelId = session.forumChannelId;
			if (!forumChannelId) {
				return interaction.reply({ content: 'Original channel context lost; cancel and restart the report.', ephemeral: true });
			}
			const parentChannel = guild.channels.cache.get(forumChannelId);
			if (!parentChannel || parentChannel.type !== 15 /* GuildForum */) {
				return interaction.reply({ content: 'Reporting can only be initiated from a forum channel.', ephemeral: true });
			}

			// Create thread (post) title summarizing categories + target
			const targetLabel = session.reportedPlayerId || session.reportedNickname || 'Unknown Player';
			const titleBase = `[Report] ${targetLabel}`;
			const catsShort = session.categories.slice(0, 3).join(', ');
			const threadName = catsShort ? `${titleBase} - ${catsShort}` : titleBase;
			let createdThreadId: string | undefined;
			let firstMessageId: string | undefined;
			try {
				// @ts-ignore - forum create API (discord.js v14) createForumThread
				const embed = new EmbedBuilder()
					.setTitle('Player Report')
					.setDescription(summary)
					.addFields(
						{ name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
						{ name: 'Reported', value: targetLabel, inline: true },
						{ name: 'Categories', value: session.categories.join(', ').substring(0, 1024) },
						...(matchId ? [{ name: 'Match ID', value: matchId, inline: true }] : [])
					)
					.setTimestamp(new Date());
				const thread = await (parentChannel as any).threads.create({
					name: threadName.substring(0, 95),
					message: { embeds: [embed] }
				});
				createdThreadId = thread.thread?.id || thread.id;
				firstMessageId = thread.message?.id;
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
