import { container } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import { ModerationCaseActionModel, type ModerationActionType } from './db/models/ModerationCaseAction';
import { ModeratorTierStatusModel } from './db/models/ModeratorTierStatus';
import { ModeratorWeeklyPointsModel, type ActivityWeightClass, type CategoryPointsDetail } from './db/models/ModeratorWeeklyPoints';
import { ModmailThreadClosureModel } from './db/models/ModmailThreadClosure';
import { getChannelsInCategory, getGuild, getWeekRange } from './utils';
import { CATEGORY_CONFIG, WEIGHT_BUDGETS } from './constants';

export type StatBotSeries = Array<{
	count: number;
	unixTimestamp: number;
}>;

export interface IndividualMetrics {
	stardusts: number;
	modChatMessages: number;
	publicChatMessages: number;
	voiceChatMinutes: number;
	modActionsTaken: number;
	casesHandled: number;
}

// --- Core Computation Logic ---
interface ComputedPointsResult {
	details: CategoryPointsDetail[];
	totalRawPoints: number;
	totalFinalizedPoints: number;
	totalWastedPoints: number;
}

export function computeWeightedPoints(metrics: Omit<IndividualMetrics, 'stardusts'>): ComputedPointsResult & { dynamicMaxPossible: number } {
	// First pass: compute raw points per category (no caps yet) to derive dynamic max possible.
	const categoryEntries: Array<{ key: keyof typeof CATEGORY_CONFIG; amount: number; rawPoints: number; weightClass: ActivityWeightClass }> = [
		{
			key: 'modChatMessages',
			amount: metrics.modChatMessages,
			rawPoints: metrics.modChatMessages * CATEGORY_CONFIG.modChatMessages.pointsPerUnit,
			weightClass: CATEGORY_CONFIG.modChatMessages.weightClass
		},
		{
			key: 'publicChatMessages',
			amount: metrics.publicChatMessages,
			rawPoints: metrics.publicChatMessages * CATEGORY_CONFIG.publicChatMessages.pointsPerUnit,
			weightClass: CATEGORY_CONFIG.publicChatMessages.weightClass
		},
		{
			key: 'voiceChatMinutes',
			amount: metrics.voiceChatMinutes,
			rawPoints: metrics.voiceChatMinutes * CATEGORY_CONFIG.voiceChatMinutes.pointsPerUnit,
			weightClass: CATEGORY_CONFIG.voiceChatMinutes.weightClass
		},
		{
			key: 'modActionsTaken',
			amount: metrics.modActionsTaken,
			rawPoints: metrics.modActionsTaken * CATEGORY_CONFIG.modActionsTaken.pointsPerUnit,
			weightClass: CATEGORY_CONFIG.modActionsTaken.weightClass
		},
		{
			key: 'casesHandled',
			amount: metrics.casesHandled,
			rawPoints: metrics.casesHandled * CATEGORY_CONFIG.casesHandled.pointsPerUnit,
			weightClass: CATEGORY_CONFIG.casesHandled.weightClass
		}
	];

	const dynamicMaxPossible = categoryEntries.reduce((sum, c) => sum + c.rawPoints, 0); // e.g., 5356 from example

	// Derive budgets per weight class from dynamic max possible
	const weightBudgetsAbsolute: Record<ActivityWeightClass, number> = {
		HIGH: dynamicMaxPossible * WEIGHT_BUDGETS.HIGH,
		MEDIUM: dynamicMaxPossible * WEIGHT_BUDGETS.MEDIUM,
		LOW: dynamicMaxPossible * WEIGHT_BUDGETS.LOW
	};

	// Ensure rounding consistency (optional) - keep as float for precision here
	const details: CategoryPointsDetail[] = [];
	const spent: Record<ActivityWeightClass, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };

	for (const entry of categoryEntries) {
		const budget = weightBudgetsAbsolute[entry.weightClass];
		const remainingBudget = Math.max(0, budget - spent[entry.weightClass]);
		const appliedPoints = Math.min(entry.rawPoints, remainingBudget);
		const wastedPoints = Math.max(0, entry.rawPoints - appliedPoints);
		spent[entry.weightClass] += appliedPoints;
		details.push({
			category: entry.key,
			weightClass: entry.weightClass,
			rawAmount: entry.amount,
			rawPoints: entry.rawPoints,
			appliedPoints,
			wastedPoints,
			bracketBudget: budget
		});
	}

	const totalRawPoints = dynamicMaxPossible;
	const totalFinalizedPoints = details.reduce((a, d) => a + d.appliedPoints, 0);
	const totalWastedPoints = details.reduce((a, d) => a + d.wastedPoints, 0);

	return { details, totalRawPoints, totalFinalizedPoints, totalWastedPoints, dynamicMaxPossible };
}

// Manual tier management: no auto promotion/demotion. We only compute and store weekly metrics.
// If an override is active on the stored weekly doc, we respect overrideFinalizedPoints for stardust payout.
async function updateTierAndPersist(memberId: string, week: number, year: number, metrics: Omit<IndividualMetrics, 'stardusts'>) {
	const guildId = envParseString('MainServer_ID');
	const { details, totalRawPoints, totalFinalizedPoints, totalWastedPoints, dynamicMaxPossible } = computeWeightedPoints(metrics);

	// Ensure tier status exists (but DO NOT modify automatically)
	let tierStatus = await ModeratorTierStatusModel.findOne({ guildId, userId: memberId });
	if (!tierStatus) {
		// default tier remains 3 unless manually changed elsewhere
		tierStatus = new ModeratorTierStatusModel({
			guildId,
			userId: memberId,
			currentTier: 3,
			weeksInactive: 0,
			lastEvaluatedYear: year,
			lastEvaluatedWeek: week
		});
		await tierStatus.save();
	}

	// DO NOT alter tierStatus fields beyond updating last evaluated markers
	tierStatus.lastEvaluatedYear = year;
	tierStatus.lastEvaluatedWeek = week;
	await tierStatus.save();

	// Upsert weekly points snapshot (retain existing override fields if present)
	const existingWeekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: memberId, week, year });
	const preservedOverride = existingWeekly
		? {
				overrideActive: existingWeekly.overrideActive,
				overrideFinalizedPoints: existingWeekly.overrideFinalizedPoints,
				overrideRawPoints: existingWeekly.overrideRawPoints,
				overrideDetails: existingWeekly.overrideDetails,
				overrideReason: existingWeekly.overrideReason,
				overrideAppliedById: existingWeekly.overrideAppliedById,
				overrideAppliedAt: existingWeekly.overrideAppliedAt
			}
		: {};

	const weekly = await ModeratorWeeklyPointsModel.findOneAndUpdate(
		{ guildId, userId: memberId, week, year },
		{
			guildId,
			userId: memberId,
			week,
			year,
			maxPossiblePoints: dynamicMaxPossible,
			totalRawPoints,
			totalFinalizedPoints,
			totalWastedPoints,
			details,
			tierAfterWeek: tierStatus.currentTier,
			...preservedOverride
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true }
	);

	// Decide stardusts (respect override)
	let stardusts = totalFinalizedPoints;
	if (weekly.overrideActive && typeof weekly.overrideFinalizedPoints === 'number') {
		stardusts = weekly.overrideFinalizedPoints;
	}

	return { stardusts, totalFinalizedPoints: stardusts, currentTier: tierStatus.currentTier };
}

async function ensureGuildAndCategories() {
	const serverID = envParseString('MainServer_ID');
	const guild = await getGuild(serverID);
	if (!guild) throw new Error('Guild not found');

	const modChatChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModChatCategoryID'));
	const modCommandsChannelIds = await getChannelsInCategory(guild, envParseString('MainServer_ModCommandsCategoryID'));

	return { serverID, guild, modChatChannelIds, modCommandsChannelIds };
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

async function fetchSeries(url: string, params: Record<string, unknown>) {
	const client = container.statBotClient;
	if (!client) throw new Error('StatBot client not initialized');
	const res = await client.get<StatBotSeries>(appendParamsToUrl(url, params));
	return res.data;
}

export async function fetchModChatMessageCount(memberId: string, week: number, year: number): Promise<number> {
	const { start, end } = getWeekRange(week, year);
	const { serverID, modChatChannelIds } = await ensureGuildAndCategories();

	const data = await fetchSeries(`/guilds/${serverID}/messages/series`, {
		start: start.getTime(),
		end: end.getTime(),
		interval: 'week',
		'whitelist_members[]': [memberId],
		'whitelist_channels[]': modChatChannelIds
	});

	return data.reduce((sum, s) => sum + s.count, 0);
}

export async function fetchPublicChatMessageCount(memberId: string, week: number, year: number): Promise<number> {
	const { start, end } = getWeekRange(week, year);
	const { serverID, modChatChannelIds, modCommandsChannelIds } = await ensureGuildAndCategories();

	const blacklist = [...modChatChannelIds, ...modCommandsChannelIds];
	const data = await fetchSeries(`/guilds/${serverID}/messages/series`, {
		start: start.getTime(),
		end: end.getTime(),
		interval: 'week',
		'whitelist_members[]': [memberId],
		'blacklist_channels[]': blacklist
	});

	return data.reduce((sum, s) => sum + s.count, 0);
}

export async function fetchVoiceMinutes(memberId: string, week: number, year: number): Promise<number> {
	const { start, end } = getWeekRange(week, year);
	const { serverID, modChatChannelIds, modCommandsChannelIds } = await ensureGuildAndCategories();

	const blacklist = [...modChatChannelIds, ...modCommandsChannelIds];
	const data = await fetchSeries(`/guilds/${serverID}/voice/series`, {
		start: start.getTime(),
		end: end.getTime(),
		interval: 'week',
		'whitelist_members[]': [memberId],
		'blacklist_channels[]': blacklist,
		'voice_states[]': ['normal']
	});

	return data.reduce((sum, s) => sum + s.count, 0);
}

export async function fetchModActions(memberId: string, week: number, year: number): Promise<number> {
	const guild = await getGuild(envParseString('MainServer_ID'));
	if (!guild) throw new Error('Guild not found');

	const { start, end } = getWeekRange(week, year);

	const member = await guild.members.fetch(memberId).catch(() => null);
	if (!member || !member.user) return 0;

	try {
		const pipeline = [
			{
				$match: {
					guildId: guild.id,
					performedByUsername: `@${member.user.username}`,
					performedAt: { $gte: start, $lte: end }
				}
			},
			{ $group: { _id: '$action', count: { $sum: 1 } } }
		];

		const results: Array<{ _id: ModerationActionType; count: number }> = await ModerationCaseActionModel.aggregate(pipeline);

		const counts: Record<ModerationActionType, number> = {
			BAN: 0,
			UNBAN: 0,
			WARN: 0,
			MUTE: 0,
			KICK: 0,
			UPDATE: 0
		};

		for (const row of results) {
			counts[row._id] = row.count;
		}

		return counts['BAN'] + counts['WARN'] + counts['MUTE'] + counts['KICK'];
	} catch (error) {
		container.logger.error('Error fetching audit logs', error);
		return 0;
	}
}

export async function fetchModmailCases(memberId: string, week: number, year: number): Promise<number> {
	const guild = await getGuild(envParseString('MainServer_ID'));
	if (!guild) throw new Error('Guild not found');

	const { start, end } = getWeekRange(week, year);

	const member = await guild.members.fetch(memberId).catch(() => null);
	if (!member || !member.user) return 0;

	try {
		const count = await ModmailThreadClosureModel.find({
			guildId: guild.id,
			approved: true,
			closedAt: { $gte: start, $lte: end },
			pointsAwardedToId: memberId
		});

		console.log(`Modmail cases for ${member.user.tag} (${memberId}) in week ${week} ${year}: ${count.length}`);
		count.forEach((c) => container.logger.debug(` - ${c.userId} closed at ${c.closedAt.toISOString()} (awarded to ${c.pointsAwardedToId})`));

		return count.length;
	} catch (error) {
		container.logger.error('Error fetching modmail cases', error);
		return 0;
	}
}

export async function fetchAllIndividualMetrics(memberId: string, week: number, year: number): Promise<IndividualMetrics> {
	const [modChatMessages, publicChatMessages, voiceChatMinutes, modActionsTaken, casesHandled] = await Promise.all([
		fetchModChatMessageCount(memberId, week, year),
		fetchPublicChatMessageCount(memberId, week, year),
		fetchVoiceMinutes(memberId, week, year),
		fetchModActions(memberId, week, year),
		fetchModmailCases(memberId, week, year)
	]);

	const { stardusts } = await updateTierAndPersist(memberId, week, year, {
		modChatMessages,
		publicChatMessages,
		voiceChatMinutes,
		modActionsTaken,
		casesHandled
	});

	return { stardusts, modChatMessages, publicChatMessages, voiceChatMinutes, modActionsTaken, casesHandled };
}

export async function getIndividualReport(memberId: string, week: number, year: number): Promise<IndividualMetrics> {
	// Centralized function so both the report generator and test-metric use the same fetchers
	return fetchAllIndividualMetrics(memberId, week, year);
}
