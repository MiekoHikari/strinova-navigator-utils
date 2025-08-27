import { BabloPaymentPreferenceModel } from '#lib/db/models/BabloPaymentPreference';
import { EnrolledModeratorModel } from '#lib/db/models/EnrolledModerator';
import { ModeratorTierStatusModel } from '#lib/db/models/ModeratorTierStatus';
import { TIER_PAYOUT } from '#lib/stardustTally';
import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { envParseString } from '@skyra/env-utilities';
import { EmbedBuilder, inlineCode, userMention } from 'discord.js';

@ApplyOptions<Subcommand.Options>({
	name: 'bablo',
	description: 'Manage bablo payment UID opt-in',
	subcommands: [
		{ name: 'set', chatInputRun: 'set', type: 'method' },
		{ name: 'clear', chatInputRun: 'clear', type: 'method' },
		{ name: 'show', chatInputRun: 'show', type: 'method' },
		{ name: 'list', chatInputRun: 'list', type: 'method', preconditions: [['staffOnly', 'leadModsOnly']] }
	]
})
export class BabloCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((s) =>
					s
						.setName('set')
						.setDescription('Opt-in or update the UID where you want bablo payments')
						.addStringOption((o) => o.setName('uid').setDescription('Target UID').setRequired(true))
				)
				.addSubcommand((s) => s.setName('clear').setDescription('Opt-out of bablo payments'))
				.addSubcommand((s) => s.setName('show').setDescription('Show your current bablo payment status'))
				.addSubcommand((s) => s.setName('list').setDescription('Staff: list opted-in members (tier & payout)'))
		);
	}

	private getGuildIds() {
		return { guildId: envParseString('MainServer_ID'), staffRoleId: envParseString('MainServer_StaffRoleID') };
	}

	private async ensureEnrolled(guildId: string, userId: string) {
		const enrolled = await EnrolledModeratorModel.findOne({ guildId, userId, active: true }).lean();
		return Boolean(enrolled);
	}

	public async set(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const { guildId } = this.getGuildIds();
		const uidRaw = interaction.options.getString('uid', true).trim();

		if (!(await this.ensureEnrolled(guildId, interaction.user.id))) {
			return interaction.editReply({ content: 'You must be enrolled in the stardust program to set a bablo UID.' });
		}

		if (uidRaw.length < 3 || uidRaw.length > 128) {
			return interaction.editReply({ content: 'UID must be between 3 and 128 characters.' });
		}

		let pref = await BabloPaymentPreferenceModel.findOne({ guildId, userId: interaction.user.id });
		const now = new Date();
		if (!pref) {
			pref = new BabloPaymentPreferenceModel({ guildId, userId: interaction.user.id, targetUid: uidRaw, optedIn: true, optedInAt: now });
		} else {
			pref.targetUid = uidRaw;
			if (!pref.optedIn) {
				pref.optedIn = true;
				pref.optedInAt = now;
				pref.optedOutAt = undefined;
			}
		}
		await pref.save();
		return interaction.editReply({ content: `Opted in. Your bablo payments UID is now: ${inlineCode(pref.targetUid)}` });
	}

	public async clear(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const { guildId } = this.getGuildIds();
		if (!(await this.ensureEnrolled(guildId, interaction.user.id))) {
			return interaction.editReply({ content: 'You are not enrolled.' });
		}

		const pref = await BabloPaymentPreferenceModel.findOne({ guildId, userId: interaction.user.id });
		if (!pref || !pref.optedIn) return interaction.editReply({ content: 'You are not currently opted in.' });
		pref.optedIn = false;
		pref.optedOutAt = new Date();
		await pref.save();
		return interaction.editReply({ content: 'You have opted out of bablo payments. (UID retained; you can /bablo set to rejoin.)' });
	}

	public async show(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const { guildId } = this.getGuildIds();
		if (!(await this.ensureEnrolled(guildId, interaction.user.id))) {
			return interaction.editReply({ content: 'Not enrolled. Use /stardust-enroll activate first.' });
		}
		const pref = await BabloPaymentPreferenceModel.findOne({ guildId, userId: interaction.user.id }).lean();
		const tierDoc = await ModeratorTierStatusModel.findOne({ guildId, userId: interaction.user.id }).lean();
		const tier = tierDoc?.currentTier ?? 3;
		const payout = (TIER_PAYOUT as Record<number, number>)[tier] ?? 0;

		if (!pref) {
			return interaction.editReply({
				content: `Not configured. Use ${inlineCode('/bablo set <uid>')} to opt-in. Current Tier: ${tier} (payout ${payout}).`
			});
		}

		const status = pref.optedIn ? 'Opted In' : 'Opted Out';
		return interaction.editReply({
			content: `${status}. UID: ${pref.targetUid ? inlineCode(pref.targetUid) : '—'} | Tier ${tier} (payout ${payout}).`
		});
	}

	public async list(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		if (!interaction.inCachedGuild()) return interaction.editReply({ content: 'Server only.' });
		const { staffRoleId } = this.getGuildIds();
		const member = await interaction.guild.members.fetch(interaction.user.id);
		if (!member.roles.cache.has(staffRoleId)) return interaction.editReply({ content: 'Insufficient permission.' });
		const guildId = interaction.guildId!;
		const prefs = await BabloPaymentPreferenceModel.find({ guildId, optedIn: true }).lean();
		if (prefs.length === 0) return interaction.editReply({ content: 'No members are currently opted in.' });

		const userIds = prefs.map((p) => p.userId);
		const tiers = await ModeratorTierStatusModel.find({ guildId, userId: { $in: userIds } }).lean();
		const tierMap = new Map<string, number>();
		for (const t of tiers) tierMap.set(t.userId, t.currentTier);

		const lines: string[] = [];
		for (const p of prefs) {
			const tier = tierMap.get(p.userId) ?? 3;
			const payout = (TIER_PAYOUT as Record<number, number>)[tier] ?? 0;
			lines.push(`${userMention(p.userId)} | Tier ${tier} -> ${payout} | UID: ${p.targetUid}`);
		}
		lines.sort((a, b) => {
			const tierA = parseInt(a.split('Tier ')[1]);
			const tierB = parseInt(b.split('Tier ')[1]);
			return tierB - tierA || a.localeCompare(b);
		});
		const MAX_LINES = 40;
		const shown = lines.slice(0, MAX_LINES);
		const remaining = lines.length - shown.length;
		const embed = new EmbedBuilder()
			.setTitle('Bablo Opted-In Members')
			.setColor(0x0099ff)
			.setDescription(shown.join('\n'))
			.setFooter({ text: `${lines.length} total${remaining > 0 ? ` | ${remaining} more not shown` : ''}` });
		return interaction.editReply({ embeds: [embed] });
	}
}
