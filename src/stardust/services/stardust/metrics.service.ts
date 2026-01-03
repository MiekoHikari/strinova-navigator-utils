import { prisma } from '../../../_core/lib/prisma';
import { getDateFromWeekNumber, getGuild, getChannelsInCategory } from '../../lib/utils';
import { envParseString } from '@skyra/env-utilities';
import * as StarStatBot from '../startrack.service';
import { container } from '@sapphire/framework';
import { Stopwatch } from '@sapphire/stopwatch';

export async function fetchModActions(memberId: string, week: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[MetricsService] [fetchModActions] Fetching mod actions for ${memberId} (Week ${week}, ${year})`);

	const start = getDateFromWeekNumber(week, year, 'start');
	const end = getDateFromWeekNumber(week, year, 'end');

	const count = await prisma.modAction.count({
		where: {
			moderator: { id: memberId },
			performedAt: { gte: start, lte: end },
			action: { in: ['BAN', 'WARN', 'MUTE', 'KICK'] }
		}
	});

	container.logger.debug(`[MetricsService] [fetchModActions] Completed. Count: ${count}. Took ${stopwatch.stop()}`);
	return count;
}

export async function fetchModmailCases(memberId: string, week: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[MetricsService] [fetchModmailCases] Fetching modmail cases for ${memberId} (Week ${week}, ${year})`);

	const start = getDateFromWeekNumber(week, year, 'start');
	const end = getDateFromWeekNumber(week, year, 'end');

	const count = await prisma.modmailThreadClosure.count({
		where: {
			closedByUserId: memberId,
			approved: true,
			closedAt: { gte: start, lte: end }
		}
	});

	container.logger.debug(`[MetricsService] [fetchModmailCases] Completed. Count: ${count}. Took ${stopwatch.stop()}`);
	return count;
}

export async function fetchAllMetrics(memberId: string, week: number, year: number) {
	const stopwatch = new Stopwatch();
	container.logger.debug(`[MetricsService] [fetchAllMetrics] Fetching all metrics for ${memberId} (Week ${week}, ${year})`);

	const serverID = envParseString('MainServer_ID');
	const guild = await getGuild(serverID);
	const modChatChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModChatCategoryID'));
	const modCommandsChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModCommandsCategoryID'));

	const [modChatMessages, publicChatMessages, voiceChatMinutes, modActionsTaken, casesHandled] = await Promise.all([
		StarStatBot.fetchModChatMessageCount({ moderatorId: memberId, week, year, serverID, channelIds: modChatChannelIds }),
		StarStatBot.fetchPublicChatMessageCount({
			moderatorId: memberId,
			week,
			year,
			serverID,
			channelIds: [...modChatChannelIds, ...modCommandsChannelIds]
		}),
		StarStatBot.fetchVoiceMinutes({
			moderatorId: memberId,
			week,
			year,
			serverID,
			channelIds: [...modChatChannelIds, ...modCommandsChannelIds]
		}),
		fetchModActions(memberId, week, year),
		fetchModmailCases(memberId, week, year)
	]);

	container.logger.debug(`[MetricsService] [fetchAllMetrics] Completed. Took ${stopwatch.stop()}`);

	return {
		modChatMessages,
		publicChatMessages,
		voiceChatMinutes,
		modActionsTaken,
		casesHandled
	};
}
