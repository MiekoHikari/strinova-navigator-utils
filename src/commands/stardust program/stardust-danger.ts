import { GeneratedReportModel } from '#lib/db/models/GeneratedReport';
import { backfillRecentReports } from '#lib/reports';
import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { envParseString } from '@skyra/env-utilities';

@ApplyOptions<Subcommand.Options>({
	name: 'stardust-danger',
	description: 'Dangerous stardust maintenance operations (staff / lead mods only).',
	preconditions: [['staffOnly', 'leadModsOnly']],
	subcommands: [
		{ name: 'backfill', chatInputRun: 'backfill', type: 'method' },
		{ name: 'clear', chatInputRun: 'clear', type: 'method' }
	]
})
export class StardustDangerCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName(this.name)
				.setDescription(this.description)
				.addSubcommand((s) => s.setName('backfill').setDescription('Trigger backfill of weekly (12) and monthly (3) reports'))
				.addSubcommand((s) => s.setName('clear').setDescription('Clear ALL generated report records (does not delete messages)'))
		);
	}

	public async backfill(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		await backfillRecentReports();
		return interaction.editReply({ content: 'Backfill operation completed (or skipped if none active).' });
	}

	public async clear(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });
		const guildId = envParseString('MainServer_ID');
		const { deletedCount } = await GeneratedReportModel.deleteMany({ guildId });
		return interaction.editReply({ content: `Cleared ${deletedCount} generated report record(s). Messages in channels were not deleted.` });
	}
}
