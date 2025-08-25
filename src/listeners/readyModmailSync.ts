import { ModmailThreadClosureModel } from '#lib/db/models/ModmailThreadClosure';
import { seekApproval } from '#lib/modmailManager';
import { parseModmailEmbed } from '#lib/parser/modmailParser';
import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import { ChannelType, type Message, type Snowflake, type TextChannel } from 'discord.js';

const MODMAIL_CHANNEL_ENV = 'MainServer_ModMailChannelID';

@ApplyOptions<Listener.Options>({ event: 'ready', once: true })
export class ReadyModmailSyncListener extends Listener {
	public async run() {
		const guild = await this.container.client.guilds.fetch(envParseString('MainServer_ID'));
		if (!guild) return;

		const channelId = envParseString(MODMAIL_CHANNEL_ENV as unknown as any);
		const channel = await guild.channels.fetch(channelId);
		if (!channel || channel.type !== ChannelType.GuildText) return;

		await this.syncChannel(channel as TextChannel);
	}

	private async syncChannel(channel: TextChannel) {
		this.container.logger.info(`[ModmailSync] Starting sync for channel ${channel.id}`);

		const newestMessages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
		const newestChannelMessage = newestMessages?.first();

		if (!newestChannelMessage) {
			this.container.logger.info('[ModmailSync] No messages found, skipping');
			return;
		}

		const newestDbRecord = await ModmailThreadClosureModel.findOne({ channelId: channel.id })
			.sort({ closedAt: -1 })
			.select({ messageId: 1, closedAt: 1 })
			.lean()
			.catch(() => null as any);

		if (newestDbRecord && newestDbRecord.messageId === newestChannelMessage.id) {
			this.container.logger.info('[ModmailSync] Database already up-to-date; skipping backfill.');
			return;
		}

		let before: Snowflake | undefined = undefined;
		let processed = 0;
		let alreadyHadStreak = 0;
		let batch = await channel.messages.fetch({ limit: 100, before });

		const MAX_MESSAGES = 5000;
		const MAX_CONSECUTIVE_ALREADY = 50;

		while (processed < MAX_MESSAGES) {
			if (!batch || batch.size === 0) break;

			for (const msg of batch.values()) {
				const had = await this.handleMessage(msg);

				if (had) {
					alreadyHadStreak++;
					if (alreadyHadStreak >= MAX_CONSECUTIVE_ALREADY) {
						this.container.logger.info(
							`[ModmailSync] Encountered ${alreadyHadStreak} consecutive existing records; assuming history synced. Stopping.`
						);
						processed += batch.size;
						return this.container.logger.info(`[ModmailSync] Completed sync. Processed ${processed} messages.`);
					}
				} else {
					alreadyHadStreak = 0;
				}
			}

			processed += batch.size;
			before = batch.lastKey();
			await new Promise((res) => setTimeout(res, 250));
			if (!before) break;
		}

		this.container.logger.info(`[ModmailSync] Completed sync. Processed ${processed} messages.`);
	}

	private async handleMessage(message: Message): Promise<boolean> {
		if (!message.embeds.length) return true;
		let allExisting = true;

		// Threshold (7 days) for when to seek manual approval vs auto-approve
		const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
		const now = Date.now();

		for (const embed of message.embeds) {
			const parsed = parseModmailEmbed(embed);
			if (!parsed) continue;

			const existing = await ModmailThreadClosureModel.findOne({ messageId: message.id }).lean();
			const closedAtTime = (parsed.closedAt ?? message.createdAt).getTime();
			const isRecent = now - closedAtTime <= RECENT_MS;

			const messageLink = `https://discord.com/channels/${message.guild?.id ?? '@me'}/${message.channel.id}/${message.id}`;

			if (!existing) {
				allExisting = false;
				// Insert new record; mark approved immediately if not recent
				await ModmailThreadClosureModel.updateOne(
					{ messageId: message.id },
					{
						$setOnInsert: {
							guildId: message.guild?.id,
							channelId: message.channel.id,
							messageId: message.id,
							userId: parsed.userId
						},
						$set: {
							username: parsed.username,
							closedByUsername: parsed.closedByUsername,
							closedByUserId: parsed.closedById,
							// Default points awarded to the closing moderator unless later overridden
							pointsAwardedToId: parsed.closedById,
							closedByFooterRaw: parsed.rawFooter,
							closedAt: parsed.closedAt ?? message.createdAt,
							messageLink,
							rawEmbed: embed.toJSON(),
							...(isRecent
								? {}
								: {
										approved: true,
										approvedAt: new Date(closedAtTime),
										approvedById: this.container.client.user?.id
									})
						}
					},
					{ upsert: true }
				).catch((error) => this.container.logger.error('[ModmailSync] Upsert failed', error));

				// For recent closures, create approval request
				if (isRecent && message.guild) {
					seekApproval(message, parsed.closedById).catch((e) => this.container.logger.error('Failed to send approval request embed', e));
				}
			} else if (!isRecent && !existing.approved) {
				// Retroactively auto-approve old unresolved record
				await ModmailThreadClosureModel.updateOne(
					{ messageId: message.id, approved: false },
					{
						$set: {
							approved: true,
							approvedAt: new Date(closedAtTime),
							approvedById: this.container.client.user?.id
						}
					}
				).catch((error) => this.container.logger.error('[ModmailSync] Retro approve failed', error));
			}
		}

		return allExisting;
	}
}
