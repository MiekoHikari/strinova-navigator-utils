import { ApplyOptions } from '@sapphire/decorators';
import { Events, Listener } from '@sapphire/framework';
import { syncModActions, syncModmail } from '../services/stardust/sync.service';
import { backfillWeeklyRecords } from '../services/stardust/stats.service';

// BUG: Disabled until stardust module is fully ready for use

@ApplyOptions<Listener.Options>({ event: Events.ClientReady, once: true, enabled: true })
export class StardustReady extends Listener {
	public async run() {
		this.container.logger.info('[Stardust] Stardust module is ready.');
		const fetched = await this.fetchChannelsAndGuilds();
		if (!fetched) return this.container.logger.warn('[Stardust] Failed to fetch necessary guild or channels.');

		const { casesChannel, modmailChannel } = fetched;

		// Catch up with missed mod actions and modmails since bot downtime
		await syncModActions(casesChannel);
		if (modmailChannel) await syncModmail(modmailChannel);

		await backfillWeeklyRecords();

		this.container.logger.info('[Stardust] Completed catch-up of mod actions and modmail.');
	}

	private async fetchChannelsAndGuilds() {
		const server = await this.container.client.guilds.fetch(process.env.MainServer_ID);
		if (!server) return;

		const casesChannel = await server.channels.fetch(process.env.MainServer_ModCasesChannelID);
		const modmailChannel = await server.channels.fetch(process.env.MainServer_ModMailChannelID);

		if (!casesChannel?.isTextBased()) return;

		return { server, casesChannel, modmailChannel: modmailChannel?.isTextBased() ? modmailChannel : null };
	}
}
