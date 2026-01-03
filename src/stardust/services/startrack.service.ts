// Star-Track Service Layer
// Handles all interactions related to fetching and updating stardust statistics

import { container } from '@sapphire/framework';
import { Stopwatch } from '@sapphire/stopwatch';
import { getDateFromWeekNumber, getWeekRange } from '../lib/utils';

export interface StatBotSeries {
	count: number;
	unixTimestamp: number;
}

interface BaseQueryOptions {
	moderatorId: string;
	week: number;
	year: number;
	serverID: string;
}

interface ChannelQueryOptions extends BaseQueryOptions {
	channelIds: string[];
}

function appendParamsToUrl(url: string, params: Record<string, unknown>): string {
	const [path, existingQuery = ''] = url.split('?');
	const search = new URLSearchParams(existingQuery);

	const append = (key: string, value: unknown) => {
		if (value === undefined || value === null) return;
		if (Array.isArray(value)) {
			for (const v of value) append(key, v);
		} else {
			search.append(key, String(value));
		}
	};

	for (const [key, value] of Object.entries(params)) {
		append(key, value);
	}

	const queryString = search.toString();
	return queryString ? `${path}?${queryString}` : path;
}

async function fetchSeriesData(url: string, params: Record<string, unknown>): Promise<number> {
	const stopwatch = new Stopwatch();
	const fullUrl = appendParamsToUrl(url, params);
	container.logger.debug(`[Startrack] [fetchSeriesData] Fetching data from: ${fullUrl}`);

	try {
		const response = await container.statBotClient.axios.get(fullUrl);
		const data = response.data as StatBotSeries[];
		const total = data.reduce((sum, s) => sum + s.count, 0);
		container.logger.debug(`[Startrack] [fetchSeriesData] Fetched ${data.length} data points. Total count: ${total}. Took ${stopwatch.stop()}`);
		return total;
	} catch (error) {
		container.logger.error(`[Startrack] [fetchSeriesData] Error fetching data from ${fullUrl}:`, error);
		throw error;
	}
}

async function getStartAndEndTimes(week: number, year: number) {
	const { startWeek, endWeek } = await getWeekRange(week, year);
	const start = getDateFromWeekNumber(startWeek, year, 'start').getTime();
	const endDate = getDateFromWeekNumber(endWeek, year, 'end');
	endDate.setHours(23, 59, 59, 999);
	const end = endDate.getTime();
	return { start, end };
}

export async function fetchModChatMessageCount(options: ChannelQueryOptions) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[Startrack] [fetchModChatMessageCount] Fetching mod chat messages for ${options.moderatorId} (Week ${options.week}, ${options.year})`);

	const { start, end } = await getStartAndEndTimes(options.week, options.year);

	const result = await fetchSeriesData(`/guilds/${options.serverID}/messages/series`, {
		start,
		end,
		interval: 'week',
		'whitelist_members[]': [options.moderatorId],
		'whitelist_channels[]': options.channelIds
	});

	container.logger.info(`[Startrack] [fetchModChatMessageCount] Completed. Count: ${result}. Took ${stopwatch.stop()}`);
	return result;
}

export async function fetchPublicChatMessageCount(options: ChannelQueryOptions) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[Startrack] [fetchPublicChatMessageCount] Fetching public chat messages for ${options.moderatorId} (Week ${options.week}, ${options.year})`);

	const { start, end } = await getStartAndEndTimes(options.week, options.year);

	const result = await fetchSeriesData(`/guilds/${options.serverID}/messages/series`, {
		start,
		end,
		interval: 'week',
		'whitelist_members[]': [options.moderatorId],
		'blacklist_channels[]': options.channelIds
	});

	container.logger.info(`[Startrack] [fetchPublicChatMessageCount] Completed. Count: ${result}. Took ${stopwatch.stop()}`);
	return result;
}

export async function fetchVoiceMinutes(options: ChannelQueryOptions) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[Startrack] [fetchVoiceMinutes] Fetching voice minutes for ${options.moderatorId} (Week ${options.week}, ${options.year})`);

	const { start, end } = await getStartAndEndTimes(options.week, options.year);

	const result = await fetchSeriesData(`/guilds/${options.serverID}/voice/series`, {
		start,
		end,
		interval: 'week',
		'whitelist_members[]': [options.moderatorId],
		'blacklist_channels[]': options.channelIds,
		'voice_states[]': ['normal']
	});

	container.logger.info(`[Startrack] [fetchVoiceMinutes] Completed. Minutes: ${result}. Took ${stopwatch.stop()}`);
	return result;
}

export async function fetchAllStatbotMetrics(
	memberId: string,
	week: number,
	year: number,
	serverID: string,
	modChatChannelIds: string[],
	modCommandsChannelIds: string[]
) {
	const stopwatch = new Stopwatch();
	container.logger.info(`[Startrack] [fetchAllStatbotMetrics] Fetching all metrics for ${memberId} (Week ${week}, ${year})`);

	const [modChatMessages, publicChatMessages, voiceChatMinutes] = await Promise.all([
		fetchModChatMessageCount({ moderatorId: memberId, week, year, serverID, channelIds: modChatChannelIds }),
		fetchPublicChatMessageCount({
			moderatorId: memberId,
			week,
			year,
			serverID,
			channelIds: modCommandsChannelIds.concat(modChatChannelIds)
		}),
		fetchVoiceMinutes({ moderatorId: memberId, week, year, serverID, channelIds: modChatChannelIds })
	]);

	container.logger.info(`[Startrack] [fetchAllStatbotMetrics] Completed. ModChat: ${modChatMessages}, PublicChat: ${publicChatMessages}, Voice: ${voiceChatMinutes}. Took ${stopwatch.stop()}`);

	return {
		modChatMessages,
		publicChatMessages,
		voiceChatMinutes
	};
}
