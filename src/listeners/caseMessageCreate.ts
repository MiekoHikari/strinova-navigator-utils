import { ModerationCaseActionModel } from '#lib/db/models/ModerationCaseAction';
import { parseModerationEmbed } from '#lib/parser/caseParser';
import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import { ChannelType, type Message } from 'discord.js';

@ApplyOptions<Listener.Options>({ event: 'messageCreate' })
export class CaseMessageCreateListener extends Listener {
	public async run(message: Message) {
		try {
			if (!message.guild) return;
			if (message.channel.type !== ChannelType.GuildText) return;
			const modCasesChannelId = envParseString('MainServer_ModCasesChannelID');
			if (message.channel.id !== modCasesChannelId) return;
			if (!message.embeds.length) return;

			for (const embed of message.embeds) {
				const parsed = parseModerationEmbed(embed);
				if (!parsed) continue;

				await ModerationCaseActionModel.updateOne(
					{ messageId: message.id },
					{
						$setOnInsert: {
							guildId: message.guild.id,
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
				);
				this.container.logger.debug(`Stored moderation case action ${parsed.action} for case ${parsed.caseId} (message ${message.id}).`);
			}
		} catch (error) {
			this.container.logger.error('Failed to store moderation case action', error);
		}
	}
}
