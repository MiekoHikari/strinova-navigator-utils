import {
	backfillRecentReports,
	millisUntilNextIsoWeekStart,
	millisUntilNextMonthStart,
	runCurrentPeriodReports,
	scheduleNextRun
} from '#lib/reports';
import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';

@ApplyOptions<Listener.Options>({ event: 'ready', once: true })
export class ReadyReportsSchedulerListener extends Listener {
	public async run() {
		// Kick off backfill (do not await to not block ready) but log errors
		backfillRecentReports().catch((e) => this.container.logger.error('[Reports] Backfill failed', e));

		// Schedule weekly + monthly tasks
		scheduleNextRun(
			async () => {
				await runCurrentPeriodReports();
			},
			millisUntilNextIsoWeekStart,
			'weekly/monthly boundary reports'
		);

		// Additional safety: schedule explicit monthly in case weekly timing misses first-of-month edge
		scheduleNextRun(
			async () => {
				const now = new Date();
				if (now.getUTCDate() === 1) {
					await runCurrentPeriodReports();
				}
			},
			millisUntilNextMonthStart,
			'monthly first-of-month check'
		);
	}
}
