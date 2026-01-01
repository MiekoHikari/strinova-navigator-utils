import { envParseString } from '@skyra/env-utilities';
import { IndividualMetrics } from '../config/points';
import { prisma } from '../lib/prisma';
import { getChannelsInCategory, getGuild, getWeekRange } from '../lib/utils';
import { StatBotService } from './StatBotService';

export class MetricsService {
	private statBotService: StatBotService;

	constructor() {
		this.statBotService = new StatBotService();
	}

	private async ensureGuildAndCategories() {
		const serverID = envParseString('MainServer_ID');
		const guild = await getGuild(serverID);
		if (!guild) throw new Error('Guild not found');

		const modChatChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModChatCategoryID'));
		const modCommandsChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModCommandsCategoryID'));

		return { serverID, guild, modChatChannelIds, modCommandsChannelIds };
	}

	public async fetchModChatMessageCount(memberId: string, week: number, year: number): Promise<number> {
		const { start, end } = getWeekRange(week, year);
		const { serverID, modChatChannelIds } = await this.ensureGuildAndCategories();

		const data = await this.statBotService.fetchSeries(`/guilds/${serverID}/messages/series`, {
			start: start.getTime(),
			end: end.getTime(),
			interval: 'week',
			'whitelist_members[]': [memberId],
			'whitelist_channels[]': modChatChannelIds
		});

		return data.reduce((sum, s) => sum + s.count, 0);
	}

	public async fetchPublicChatMessageCount(memberId: string, week: number, year: number): Promise<number> {
		const { start, end } = getWeekRange(week, year);
		const { serverID, modChatChannelIds, modCommandsChannelIds } = await this.ensureGuildAndCategories();

		const blacklist = [...modChatChannelIds, ...modCommandsChannelIds];
		const data = await this.statBotService.fetchSeries(`/guilds/${serverID}/messages/series`, {
			start: start.getTime(),
			end: end.getTime(),
			interval: 'week',
			'whitelist_members[]': [memberId],
			'blacklist_channels[]': blacklist
		});

		return data.reduce((sum, s) => sum + s.count, 0);
	}

	public async fetchVoiceMinutes(memberId: string, week: number, year: number): Promise<number> {
		const { start, end } = getWeekRange(week, year);
		const { serverID, modChatChannelIds, modCommandsChannelIds } = await this.ensureGuildAndCategories();

		const blacklist = [...modChatChannelIds, ...modCommandsChannelIds];
		const data = await this.statBotService.fetchSeries(`/guilds/${serverID}/voice/series`, {
			start: start.getTime(),
			end: end.getTime(),
			interval: 'week',
			'whitelist_members[]': [memberId],
			'blacklist_channels[]': blacklist,
			'voice_states[]': ['normal']
		});

		return data.reduce((sum, s) => sum + s.count, 0);
	}

	public async fetchModActions(memberId: string, week: number, year: number): Promise<number> {
		const { start, end } = getWeekRange(week, year);

		// Count actions where the moderator is linked via ModeratorProfile -> User
		// OR fallback to username matching if we must (but let's stick to ID for new system)
		// Since we are rewriting, we assume data is populated correctly.

		// However, the old system used username matching.
		// If we want to support legacy data, we might need to look up the user's username.
		// But let's try to use the relation first.

		const count = await prisma.modAction.count({
			where: {
				moderator: { userId: memberId },
				performedAt: { gte: start, lte: end },
				action: { in: ['BAN', 'WARN', 'MUTE', 'KICK'] }
			}
		});

		return count;
	}

	public async fetchModmailCases(memberId: string, week: number, year: number): Promise<number> {
		const { start, end } = getWeekRange(week, year);

		const count = await prisma.modmailThreadClosure.count({
			where: {
				pointsAwardedToId: memberId,
				approved: true,
				closedAt: { gte: start, lte: end }
			}
		});

		return count;
	}

	public async fetchAllMetrics(memberId: string, week: number, year: number): Promise<Omit<IndividualMetrics, 'stardusts'>> {
		const [modChatMessages, publicChatMessages, voiceChatMinutes, modActionsTaken, casesHandled] = await Promise.all([
			this.fetchModChatMessageCount(memberId, week, year),
			this.fetchPublicChatMessageCount(memberId, week, year),
			this.fetchVoiceMinutes(memberId, week, year),
			this.fetchModActions(memberId, week, year),
			this.fetchModmailCases(memberId, week, year)
		]);

		return {
			modChatMessages,
			publicChatMessages,
			voiceChatMinutes,
			modActionsTaken,
			casesHandled
		};
	}
}
