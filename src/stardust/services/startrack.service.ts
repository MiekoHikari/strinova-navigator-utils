// Star-Track Service Layer
// Handles all interactions related to fetching and updating stardust statistics

import { container } from '@sapphire/framework';
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
	const response = await container.statBotClient.axios.get(appendParamsToUrl(url, params));
	const data = response.data as StatBotSeries[];
	return data.reduce((sum, s) => sum + s.count, 0);
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
	const { start, end } = await getStartAndEndTimes(options.week, options.year);

	return fetchSeriesData(`/guilds/${options.serverID}/messages/series`, {
		start,
		end,
		interval: 'week',
		'whitelist_members[]': [options.moderatorId],
		'whitelist_channels[]': options.channelIds
	});
}

export async function fetchPublicChatMessageCount(options: ChannelQueryOptions) {
	const { start, end } = await getStartAndEndTimes(options.week, options.year);

	return fetchSeriesData(`/guilds/${options.serverID}/messages/series`, {
		start,
		end,
		interval: 'week',
		'whitelist_members[]': [options.moderatorId],
		'blacklist_channels[]': options.channelIds
	});
}

export async function fetchVoiceMinutes(options: ChannelQueryOptions) {
	const { start, end } = await getStartAndEndTimes(options.week, options.year);

	return fetchSeriesData(`/guilds/${options.serverID}/voice/series`, {
		start,
		end,
		interval: 'week',
		'whitelist_members[]': [options.moderatorId],
		'blacklist_channels[]': options.channelIds,
		'voice_states[]': ['normal']
	});
}

export async function fetchAllStatbotMetrics(
	memberId: string,
	week: number,
	year: number,
	serverID: string,
	modChatChannelIds: string[],
	modCommandsChannelIds: string[]
) {
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

	return {
		modChatMessages,
		publicChatMessages,
		voiceChatMinutes
	};
}
