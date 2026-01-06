import { prisma } from '../../_core/lib/prisma';
import { ScheduledTask } from '@sapphire/plugin-scheduled-tasks';

interface EndGiveawayPayload {
	giveaway: string;
}

export class EndGiveaway extends ScheduledTask {
	public constructor(context: ScheduledTask.LoaderContext, options: ScheduledTask.Options) {
		super(context, {
			...options,
			name: 'endGiveaway'
		});
	}

	public async run(payload: EndGiveawayPayload) {
		const collection = await prisma.giveawayCollection.findUnique({
			where: { id: payload.giveaway },
			include: { giveawayWinners: true }
		});

		if (!collection) {
			this.container.logger.warn(`[Giveaway][EndGiveaway] Giveaway collection with ID ${payload.giveaway} not found.`);
			return;
		}

		await prisma.giveawayCollection.update({
			where: { id: collection.id },
			data: { endedAt: new Date() }
		});

		this.container.logger.info(`[Giveaway][EndGiveaway] Giveaway collection with ID ${payload.giveaway} has been ended.`);

		const winners = collection.giveawayWinners;

		const channel = await this.container.client.channels.fetch(collection.reportingChannelId);
		if (!channel?.isSendable()) {
			this.container.logger.warn(`[Giveaway][EndGiveaway] Reporting channel with ID ${collection.reportingChannelId} is not text-based.`);
			return;
		}

		let winnerMessage = `The giveaway collection "**${collection.name}**" has ended!\n\n**Winners:**\n`;

		if (winners.length === 0) {
			winnerMessage += 'No winners submitted.';
		} else {
			for (const winner of winners) {
				winnerMessage += `- <@${winner.discordUserId}> - ${winner.userId ? winner.userId : 'No user ID'}\n`;
			}
		}

		await channel.send(winnerMessage);
	}
}

declare module '@sapphire/plugin-scheduled-tasks' {
	interface ScheduledTasks {
		endGiveaway: EndGiveawayPayload;
	}
}
