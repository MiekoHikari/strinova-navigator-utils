import { ModerationCaseActionModel } from '#lib/db/models/ModerationCaseAction';
import { parseModerationEmbed } from '#lib/parser/caseParser';
import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import { ChannelType, type Message, type Snowflake, type TextChannel } from 'discord.js';

@ApplyOptions<Listener.Options>({ event: 'ready', once: true })
export class ReadyCasesSyncListener extends Listener {
	public async run() {
		const channelId = envParseString('MainServer_ModCasesChannelID');
		const guild = this.container.client.guilds.cache.get(envParseString('MainServer_ID'));
		if (!guild) return;
		try {
			const channel = await guild.channels.fetch(channelId);
			if (!channel || channel.type !== ChannelType.GuildText) return;
			await this.syncChannel(channel as TextChannel);
		} catch (error) {
			this.container.logger.error('Failed initial cases sync', error);
		}
	}

	private async syncChannel(channel: TextChannel) {
		this.container.logger.info(`[CasesSync] Starting sync for channel ${channel.id}`);

		// Fetch the newest message in the channel (Discord side)
		const newestMessages = await channel.messages.fetch({ limit: 1 }).catch(() => null);
		const newestChannelMessage = newestMessages?.first();
		if (!newestChannelMessage) {
			this.container.logger.info('[CasesSync] No messages found, skipping');
			return;
		}

		// Fetch newest stored DB record for this channel
		const newestDbRecord = await ModerationCaseActionModel.findOne({ channelId: channel.id })
			.sort({ performedAt: -1 })
			.select({ messageId: 1, performedAt: 1 })
			.lean()
			.catch(() => null as any);

		if (newestDbRecord && newestDbRecord.messageId === newestChannelMessage.id) {
			this.container.logger.info('[CasesSync] Database already up-to-date; skipping backfill.');
			return; // Fast exit
		}

		let before: Snowflake | undefined = undefined;
		let processed = 0;
		let alreadyHadStreak = 0; // number of consecutive messages already stored
		const MAX_CONSECUTIVE_ALREADY = 50; // safety threshold to early break when deep into previously stored history
		const MAX_MESSAGES = 5000; // overall cap

		while (processed < MAX_MESSAGES) {
			const batch: ReturnType<typeof channel.messages.fetch> extends Promise<infer R> ? R : any = await channel.messages
				.fetch({ limit: 100, before })
				.catch(() => null as any);
			if (!batch || batch.size === 0) break;

			for (const msg of batch.values()) {
				const had = await this.handleMessage(msg);
				if (had) {
					alreadyHadStreak++;
					if (alreadyHadStreak >= MAX_CONSECUTIVE_ALREADY) {
						this.container.logger.info(
							`[CasesSync] Encountered ${alreadyHadStreak} consecutive existing records; assuming history synced. Stopping.`
						);
						processed += batch.size; // count current batch for logging clarity
						return this.container.logger.info(`[CasesSync] Completed sync. Processed ${processed} messages.`);
					}
				} else {
					alreadyHadStreak = 0; // reset streak if we inserted/updated something new
				}
			}

			processed += batch.size;
			before = batch.lastKey();
			await new Promise((res) => setTimeout(res, 250));
			if (!before) break;
		}

		this.container.logger.info(`[CasesSync] Completed sync. Processed ${processed} messages.`);
	}

	/**
	 * Handles a message. Returns true if every relevant embed in this message already existed (no new insert)
	 * so the caller can decide about early termination, false if at least one new/updated record was written.
	 */
	private async handleMessage(message: Message): Promise<boolean> {
		if (!message.embeds.length) return true; // treat as existing (nothing to do)
		let allExisting = true;
		for (const embed of message.embeds) {
			const parsed = parseModerationEmbed(embed);
			if (!parsed) continue;
			// Check if we already have this message stored
			const existing = await ModerationCaseActionModel.exists({ messageId: message.id });
			if (existing) continue; // keep allExisting true
			allExisting = false; // we will insert something new
			await ModerationCaseActionModel.updateOne(
				{ messageId: message.id },
				{
					$setOnInsert: {
						guildId: message.guild?.id,
						channelId: message.channel.id,
						messageId: message.id,
						caseId: parsed.caseId
					},
					$set: {
						action: parsed.action,
						performedByUsername: parsed.performedByUsername,
						performedAt: parsed.performedAt,
						rawEmbed: embed.toJSON()
					}
				},
				{ upsert: true }
			).catch((error) => this.container.logger.error('[CasesSync] Upsert failed', error));
		}
		return allExisting;
	}
}
