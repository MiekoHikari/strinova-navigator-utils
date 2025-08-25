import { ModmailThreadClosureModel } from '#lib/db/models/ModmailThreadClosure';
import { seekApproval } from '#lib/modmailManager';
import { parseModmailEmbed } from '#lib/parser/modmailParser';
import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import { ChannelType, type Message } from 'discord.js';

// Keep env var consistent with readyModmailSync listener
const MODMAIL_CHANNEL_ENV = 'MainServer_ModMailChannelID';

@ApplyOptions<Listener.Options>({ event: 'messageCreate' })
export class ModmailMessageCreateListener extends Listener {
	public async run(message: Message) {
		try {
			if (!message.guild) return; // ignore DMs
			if (message.channel.type !== ChannelType.GuildText) return;

			let modmailChannelId: string;
			try {
				modmailChannelId = envParseString(MODMAIL_CHANNEL_ENV as unknown as any);
			} catch {
				// Env not configured; do nothing
				return;
			}
			if (message.channel.id !== modmailChannelId) return;
			if (!message.embeds.length) return;

			let storedAny = false;
			for (const embed of message.embeds) {
				const parsed = parseModmailEmbed(embed);
				if (!parsed) continue; // not a closure embed

				const existing = await ModmailThreadClosureModel.exists({ messageId: message.id });
				if (existing) continue; // already stored (rare for live handler)

				const messageLink = `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}`;
				await ModmailThreadClosureModel.updateOne(
					{ messageId: message.id },
					{
						$setOnInsert: {
							guildId: message.guild.id,
							channelId: message.channel.id,
							messageId: message.id,
							userId: parsed.userId
						},
						$set: {
							username: parsed.username,
							closedByUsername: parsed.closedByUsername,
							closedByFooterRaw: parsed.rawFooter,
							closedAt: parsed.closedAt ?? message.createdAt,
							messageLink,
							rawEmbed: embed.toJSON()
						}
					},
					{ upsert: true }
				);
				storedAny = true;

				// Approval request for recent closures only
				const RECENT_MS = 31 * 24 * 60 * 60 * 1000;
				const now = Date.now();
				const closedAt = parsed.closedAt?.getTime() ?? message.createdTimestamp;
				if (now - closedAt <= RECENT_MS) {
					seekApproval(message).catch((e) => this.container.logger.error('Failed to send approval request embed', e));
				}
			}
			if (storedAny) {
				this.container.logger.debug(`[ModmailSync] Stored modmail closure (message ${message.id}).`);
			}
		} catch (error) {
			this.container.logger.error('[ModmailSync] Failed to store modmail closure', error);
		}
	}
}
