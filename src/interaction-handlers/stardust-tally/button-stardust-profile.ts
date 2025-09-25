import { ApplyOptions } from '@sapphire/decorators';
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework';
import type { ButtonInteraction } from 'discord.js';
// ... no additional components needed beyond Embed utilities below
import { EnrolledModeratorModel } from '#lib/db/models/EnrolledModerator';
import { ModeratorTierStatusModel } from '#lib/db/models/ModeratorTierStatus';
import { ModeratorWeeklyPointsModel } from '#lib/db/models/ModeratorWeeklyPoints';
import { getISOWeekNumber, getISOWeekYear } from '#lib/utils';
import { envParseString } from '@skyra/env-utilities';
import { EmbedBuilder, inlineCode, userMention } from 'discord.js';

@ApplyOptions<InteractionHandler.Options>({
	interactionHandlerType: InteractionHandlerTypes.Button
})
export class StardustProfileButtonHandler extends InteractionHandler {
	public override async parse(interaction: ButtonInteraction) {
		if (!interaction.customId.startsWith('stardust-profile')) return this.none();
		return this.some({});
	}

	public override async run(interaction: ButtonInteraction) {
		await interaction.deferReply({ ephemeral: true });
		const userId = interaction.user.id; // always self
		const guildId = envParseString('MainServer_ID');
		const enrollment = await EnrolledModeratorModel.findOne({ guildId, userId });
		const tier = await ModeratorTierStatusModel.findOne({ guildId, userId });
		const active = enrollment?.active ?? false;
		const currentTier = tier?.currentTier ?? 3;

		const now = new Date();
		const currentWeek = getISOWeekNumber(now);
		const currentYear = getISOWeekYear(now);
		const lines: string[] = [];
		for (let i = 0; i < 4; i++) {
			const ref = new Date(now.getTime() - i * 7 * 86400000);
			const w = getISOWeekNumber(ref);
			const wy = getISOWeekYear(ref);
			const weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId, week: w, year: wy });
			if (!weekly) {
				lines.push(`W${w} ${wy}: none`);
			} else {
				const effective =
					weekly.overrideActive && typeof weekly.overrideFinalizedPoints === 'number'
						? weekly.overrideFinalizedPoints
						: weekly.totalFinalizedPoints;
				lines.push(`W${w}: ${effective.toLocaleString()} (${weekly.totalRawPoints.toLocaleString()} raw)`);
			}
		}

		const embed = new EmbedBuilder()
			.setTitle(`Stardust Profile — ${interaction.user.username}`)
			.setColor(active ? '#cc502e' : 0x95a5a6)
			.setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 1024 }))
			.addFields(
				{ name: 'User', value: `${userMention(userId)} (${inlineCode(userId)})`, inline: false },
				{ name: 'Enrollment', value: active ? 'Active' : 'Inactive', inline: true },
				{ name: 'Current Tier', value: String(currentTier), inline: true },
				{ name: 'Recent Weeks', value: lines.join('\n') || 'No data', inline: false }
			)
			.setFooter({ text: `Current Week ${currentWeek} ${currentYear}` })
			.setTimestamp();

		return interaction.editReply({ embeds: [embed] });
	}
}
