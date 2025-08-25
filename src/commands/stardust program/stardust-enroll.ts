import { EnrolledModeratorModel } from '#lib/db/models/EnrolledModerator';
import { ModeratorWeeklyPointsModel } from '#lib/db/models/ModeratorWeeklyPoints';
import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { envParseString } from '@skyra/env-utilities';
import { EmbedBuilder, inlineCode, userMention } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'stardust-enroll',
	description: 'Manage enrollment in the stardust program',
	preconditions: [['staffOnly', 'leadModsOnly']],
	subcommands: [
		{
			name: 'activate',
			chatInputRun: 'activate',
			type: 'method'
		},
		{
			name: 'deactivate',
			chatInputRun: 'deactivate',
			type: 'method'
		},
		{
			name: 'list',
			chatInputRun: 'list',
			type: 'method'
		}
	]
})
export class StardustEnrollCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((s) =>
					s
						.setName('activate')
						.setDescription('Activate (or create) an enrollment')
						.addUserOption((o) => o.setName('user').setDescription('User to activate (defaults to you)').setRequired(false))
				)
				.addSubcommand((s) =>
					s
						.setName('deactivate')
						.setDescription('Deactivate an enrollment')
						.addUserOption((o) => o.setName('user').setDescription('User to deactivate (defaults to you)').setRequired(false))
				)
				.addSubcommand((s) => s.setName('list').setDescription('List currently active enrolled moderators'))
		);
	}

	public async activate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const guildId = envParseString('MainServer_ID');
		const target = interaction.options.getUser('user') ?? interaction.user;
		const actorId = interaction.user.id;
		const userId = target.id;
		let doc = await EnrolledModeratorModel.findOne({ guildId, userId });
		if (!doc) {
			doc = new EnrolledModeratorModel({ guildId, userId, enrolledAt: new Date(), enrolledById: actorId, active: true });
		} else if (doc.active) {
			return interaction.editReply({ content: `${userMention(userId)} is already active in the program.` });
		} else {
			doc.active = true;
			doc.deactivatedAt = undefined;
			doc.deactivatedById = undefined;
		}
		await doc.save();
		return interaction.editReply({ content: `Enrollment activated for ${userMention(userId)}.` });
	}

	public async deactivate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const guildId = envParseString('MainServer_ID');
		const target = interaction.options.getUser('user') ?? interaction.user;
		const actorId = interaction.user.id;
		const userId = target.id;
		const doc = await EnrolledModeratorModel.findOne({ guildId, userId });
		if (!doc) return interaction.editReply({ content: `${userMention(userId)} is not enrolled.` });
		if (!doc.active) return interaction.editReply({ content: `${userMention(userId)} is already deactivated.` });

		// Check if any weekly points (i.e., ever included in a report) exist
		const hasReports = await ModeratorWeeklyPointsModel.exists({ guildId, userId });
		if (!hasReports) {
			await EnrolledModeratorModel.deleteOne({ guildId, userId });
			return interaction.editReply({
				content: `Enrollment deactivated and record removed for ${userMention(userId)} (no historical reports).`
			});
		}

		doc.active = false;
		doc.deactivatedAt = new Date();
		doc.deactivatedById = actorId;
		await doc.save();
		return interaction.editReply({ content: `Enrollment deactivated for ${userMention(userId)} (history retained).` });
	}

	public async list(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const guildId = envParseString('MainServer_ID');
		const active = await EnrolledModeratorModel.find({ guildId, active: true }).sort({ enrolledAt: 1 }).lean();
		if (active.length === 0) return interaction.editReply({ content: 'No active enrolled moderators.' });

		const mentions: string[] = [];
		for (const a of active) {
			mentions.push(userMention(a.userId));
			if (mentions.length >= 50) break; // safety limit
		}

		const embed = new EmbedBuilder()
			.setTitle('Active Enrolled Moderators')
			.setColor(0x4caf50)
			.setDescription(mentions.join(' '))
			.setFooter({ text: `${active.length} total | ${inlineCode('/stardust-enroll activate')} to join` });

		return interaction.editReply({ embeds: [embed] });
	}
}
