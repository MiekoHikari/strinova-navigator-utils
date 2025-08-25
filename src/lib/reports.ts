import { container } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import { cyan, gray, magenta, yellow } from 'colorette';
import { AttachmentBuilder, Collection, EmbedBuilder, Guild, GuildMember, TextChannel } from 'discord.js';
import { EnrolledModeratorModel } from './db/models/EnrolledModerator';
import { GeneratedReportModel } from './db/models/GeneratedReport';
import { ModeratorWeeklyPointsModel } from './db/models/ModeratorWeeklyPoints';
import { getIndividualReport } from './stardustTally';
import { getISOWeekNumber, getISOWeekYear, getWeekRange } from './utils';

// --- Logging Helpers ---
const REPORTS_PREFIX = cyan('[Reports]');
function logInfo(message: string) {
	container.logger.info(`${REPORTS_PREFIX} ${message}`);
}
function logDebug(message: string) {
	container.logger.debug(`${REPORTS_PREFIX} ${gray(message)}`);
}
function logWarn(message: string) {
	container.logger.warn(`${REPORTS_PREFIX} ${yellow(message)}`);
}
function logError(message: string, error: unknown) {
	container.logger.error(`${REPORTS_PREFIX} ${message}`, error);
}

// --- Timezone Helpers (China Standard Time UTC+8) ---
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8

function toChinaDateParts(date: Date) {
	const shifted = new Date(date.getTime() + CHINA_OFFSET_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hours: shifted.getUTCHours(),
		minutes: shifted.getUTCMinutes(),
		raw: shifted
	};
}

function formatDDMMYYYY(date: Date): string {
	const { day, month, year } = toChinaDateParts(date);
	const dd = String(day).padStart(2, '0');
	const mm = String(month).padStart(2, '0');
	return `${dd}-${mm}-${year}`;
}

function formatDelay(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const parts = [] as string[];
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	parts.push(`${sec}s`);
	return parts.join(' ');
}

interface WeeklySummaryRow {
	userId: string;
	username: string;
	finalizedPoints: number;
	rawPoints: number;
	wasted: number;
	tier: number;
}

// Rounding helpers (nearest tenth)
function round1(n: number): number {
	return Math.round(n * 10) / 10;
}
function format1(n: number): string {
	return round1(n).toFixed(1);
}

export async function generateWeeklyReport(year: number, week: number): Promise<void> {
	const guildId = envParseString('MainServer_ID');
	const guild = await container.client.guilds.fetch(guildId).catch(() => null as unknown as Guild);
	if (!guild) return;

	// Ensure we don't duplicate
	const existing = await GeneratedReportModel.findOne({ guildId, type: 'WEEKLY', year, week });
	if (existing) {
		logDebug(`Weekly report already exists for ${year}-W${week}; skipping generation.`);
		return;
	}

	logInfo(`Generating weekly report for ${magenta(`${year}-W${week}`)} ...`);

	// Enrollment-driven approach: only process explicitly enrolled & active moderators.
	const enrolled = await EnrolledModeratorModel.find({ guildId, active: true }).lean();
	if (!enrolled.length) {
		logWarn('No active enrolled moderators; skipping weekly report generation.');
		return;
	}

	const moderators: Collection<string, GuildMember> = new Collection();
	for (const e of enrolled) {
		let member = guild.members.cache.get(e.userId);
		if (!member) {
			try {
				member = await guild.members.fetch(e.userId);
			} catch {
				continue; // skip if cannot fetch (user left etc.)
			}
		}
		if (member && !member.user.bot) moderators.set(member.id, member);
	}
	logDebug(`Collected ${moderators.size}/${enrolled.length} enrolled moderator members (after fetch attempts).`);

	const rows: WeeklySummaryRow[] = [];
	for (const member of moderators.values()) {
		// Try to find existing doc first
		let weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: member.id, year, week });
		if (!weekly) {
			// Will compute and persist
			await getIndividualReport(member.id, week, year).catch(() => null);
			weekly = await ModeratorWeeklyPointsModel.findOne({ guildId, userId: member.id, year, week });
		}
		if (!weekly) continue;
		rows.push({
			userId: member.id,
			username: member.user.username,
			finalizedPoints:
				weekly.overrideActive && typeof weekly.overrideFinalizedPoints === 'number'
					? weekly.overrideFinalizedPoints
					: weekly.totalFinalizedPoints,
			rawPoints: weekly.totalRawPoints,
			wasted: weekly.totalWastedPoints,
			tier: weekly.tierAfterWeek
		});
	}

	logDebug(`Collected weekly rows for ${rows.length} moderators.`);

	rows.sort((a, b) => b.finalizedPoints - a.finalizedPoints);

	const channelId = envParseString('MainServer_WeeklyReportChannelID');
	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel || !(channel instanceof TextChannel)) {
		logWarn('Weekly report channel not found or not a text channel; aborting.');
		return;
	}

	const { start, end } = getWeekRange(week, year);
	const embed = new EmbedBuilder()
		.setTitle(`Moderator Weekly Activity Report — Week ${week} ${year}`)
		.setDescription(`Period: ${formatDDMMYYYY(start)} to ${formatDDMMYYYY(end)}\nDetailed per-moderator metrics provided in attached CSV.`)
		.setColor(0x00aeef)
		.setTimestamp(new Date());

	if (rows.length === 0) {
		embed.addFields({ name: 'No Data', value: 'No moderators produced activity this period.' });
		const msg = await channel.send({ embeds: [embed] });
		await GeneratedReportModel.create({ guildId, type: 'WEEKLY', year, week, channelId, messageId: msg.id });
		logInfo(`Weekly report (empty) posted (message ${msg.id}) for ${year}-W${week}.`);
		return;
	}

	// Summary statistics only (no individual listings in embed)
	const totalFinal = rows.reduce((a, r) => a + r.finalizedPoints, 0);
	const avgFinal = totalFinal / rows.length;
	embed.addFields(
		{ name: 'Participants', value: String(rows.length), inline: true },
		{ name: 'Total Finalized', value: format1(totalFinal), inline: true },
		{ name: 'Average Finalized', value: format1(avgFinal), inline: true }
	);

	// Build CSV
	const header = 'Rank,User ID,Username,Finalized Points,Raw Points,Wasted Points,Tier';
	const csvLines = rows.map((r, i) =>
		[
			(i + 1).toString(),
			r.userId,
			r.username.replace(/,/g, ''),
			format1(r.finalizedPoints),
			format1(r.rawPoints),
			format1(r.wasted),
			r.tier.toString()
		].join(',')
	);
	const csv = [header, ...csvLines].join('\n');
	const attachment = new AttachmentBuilder(Buffer.from(csv), { name: `weekly-report-${year}-W${week}.csv` });

	const msg = await channel.send({ embeds: [embed], files: [attachment] });
	await GeneratedReportModel.create({ guildId, type: 'WEEKLY', year, week, channelId, messageId: msg.id });
	logInfo(`Weekly report posted (message ${msg.id}) for ${year}-W${week}.`);
}

export async function generateMonthlyReport(year: number, month: number): Promise<void> {
	const guildId = envParseString('MainServer_ID');
	const guild = await container.client.guilds.fetch(guildId).catch(() => null as unknown as Guild);
	if (!guild) return;

	const existing = await GeneratedReportModel.findOne({ guildId, type: 'MONTHLY', year, month });
	if (existing) {
		logDebug(`Monthly report already exists for ${year}-${String(month).padStart(2, '0')}; skipping.`);
		return;
	}

	logInfo(`Generating monthly report for ${magenta(`${year}-${String(month).padStart(2, '0')}`)} ...`);

	const channelId = envParseString('MainServer_MonthlyReportChannelID');
	const channel = await guild.channels.fetch(channelId).catch(() => null);
	if (!channel || !(channel instanceof TextChannel)) {
		logWarn('Monthly report channel not found or not a text channel; aborting.');
		return;
	}

	// Determine all weeks in this month (approx by checking ISO weeks whose Monday falls in the month)
	// We'll scan weekly docs in a reasonable range: weeks where week start between first and last day.
	const firstDay = new Date(year, month - 1, 1);
	const lastDay = new Date(year, month, 0); // last day previous month
	// Build set of (year, week) pairs to look up by iterating days stepping 7
	const seen = new Set<string>();
	for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 7)) {
		const wy = getISOWeekYear(d);
		const wn = getISOWeekNumber(d);
		seen.add(`${wy}:${wn}`);
	}
	logDebug(`Monthly aggregation will scan ${seen.size} week documents.`);

	const weeklyDocs = await ModeratorWeeklyPointsModel.find({
		guildId,
		$or: [...seen].map((s) => {
			const [wy, wn] = s.split(':').map(Number);
			return { year: wy, week: wn };
		})
	});
	const byUser = new Map<string, { userId: string; total: number }>();
	for (const w of weeklyDocs) {
		const val = w.overrideActive && typeof w.overrideFinalizedPoints === 'number' ? w.overrideFinalizedPoints : w.totalFinalizedPoints;
		const current = byUser.get(w.userId) || { userId: w.userId, total: 0 };
		current.total += val;
		byUser.set(w.userId, current);
	}

	const rows = [...byUser.values()].sort((a, b) => b.total - a.total);

	const embed = new EmbedBuilder()
		.setTitle(`Moderator Monthly Stardust Leaderboard — ${firstDay.toLocaleString('default', { month: 'long' })} ${year}`)
		.setDescription(`Summed finalized weekly stardusts (incl. overrides) across the month. (Dates in DD-MM-YYYY CST)`)
		.setColor(0xdaa520)
		.setTimestamp(new Date());

	if (rows.length === 0) {
		embed.addFields({ name: 'No Data', value: 'No activity recorded.' });
	} else {
		const lines = rows.map((r, i) => `**${i + 1}.** <@${r.userId}> — ${format1(r.total)} ⭐`);
		embed.addFields({ name: 'Leaderboard', value: lines.join('\n').slice(0, 1024) });
	}

	const msg = await channel.send({ embeds: [embed] });
	await GeneratedReportModel.create({ guildId, type: 'MONTHLY', year, month, channelId, messageId: msg.id });
	logInfo(`Monthly report posted (message ${msg.id}) for ${year}-${String(month).padStart(2, '0')}.`);
}

export async function backfillRecentReports(): Promise<void> {
	const now = new Date();
	const guildId = envParseString('MainServer_ID');
	// Skip entirely if no active enrolled moderators
	const activeCount = await EnrolledModeratorModel.countDocuments({ guildId, active: true });
	if (activeCount === 0) {
		logInfo('No active enrolled moderators; skipping backfill operations.');
		return;
	}
	logInfo('Starting backfill for recent weekly (12) and monthly (3) reports.');
	// Backfill last 12 completed weeks (exclude current week)
	for (let offset = 12; offset >= 1; offset--) {
		// Move back offset weeks
		const d = new Date(now.getTime() - offset * 7 * 24 * 60 * 60 * 1000);
		const wy = getISOWeekYear(d);
		const wn = getISOWeekNumber(d);
		// Skip if report exists
		const exists = await GeneratedReportModel.findOne({ guildId, type: 'WEEKLY', year: wy, week: wn });
		if (!exists) {
			try {
				logDebug(`Backfill: generating missing weekly ${wy}-W${wn}`);
				await generateWeeklyReport(wy, wn);
			} catch (e) {
				logError(`Weekly backfill failed for ${wy}-W${wn}`, e);
			}
		} else {
			logDebug(`Backfill: weekly ${wy}-W${wn} already exists.`);
		}
	}

	// Backfill last 3 fully completed months (exclude current month)
	for (let mOffset = 3; mOffset >= 1; mOffset--) {
		const target = new Date(now.getFullYear(), now.getMonth() - mOffset, 1);
		const y = target.getFullYear();
		const m = target.getMonth() + 1; // 1-12
		const exists = await GeneratedReportModel.findOne({ guildId, type: 'MONTHLY', year: y, month: m });
		if (!exists) {
			try {
				logDebug(`Backfill: generating missing monthly ${y}-${String(m).padStart(2, '0')}`);
				await generateMonthlyReport(y, m);
			} catch (e) {
				logError(`Monthly backfill failed for ${y}-${String(m).padStart(2, '0')}`, e);
			}
		} else {
			logDebug(`Backfill: monthly ${y}-${String(m).padStart(2, '0')} already exists.`);
		}
	}
	logInfo('Backfill complete.');
}

export function scheduleNextRun(task: () => Promise<void>, getNextDelayMs: () => number, label: string) {
	const run = async () => {
		try {
			await task();
		} catch (e) {
			logError(`Scheduled task ${label} failed`, e);
		}
		const delay = getNextDelayMs();
		setTimeout(run, delay);
		logInfo(`${label} rescheduled in ${formatDelay(delay)} (target ~ ${new Date(Date.now() + delay).toISOString()}).`);
	};
	const initial = getNextDelayMs();
	setTimeout(run, initial);
	logInfo(`Scheduled ${label} in ${formatDelay(initial)} (target ~ ${new Date(Date.now() + initial).toISOString()}).`);
}

export function millisUntilNextIsoWeekStart(): number {
	const now = new Date();
	// Week boundary: Monday 09:00 China (01:00 UTC). Find this week's Monday 01:00 UTC; if passed, schedule next week.
	const day = now.getUTCDay(); // 0 Sun
	const daysSinceMonday = (day + 6) % 7; // Mon->0
	const thisMonday0100 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday, 1, 0, 0, 0));
	let target = thisMonday0100;
	const bufferMs = 30_000;
	if (now.getTime() >= thisMonday0100.getTime() + bufferMs) target = new Date(thisMonday0100.getTime() + 7 * 24 * 60 * 60 * 1000);
	target = new Date(target.getTime() + bufferMs);
	const diff = Math.max(1_000, target.getTime() - now.getTime());
	logDebug(`Computed next week boundary (Mon 09:00 CST) in ${formatDelay(diff)} (target ${target.toISOString()}).`);
	return diff;
}

export function millisUntilNextMonthStart(): number {
	const now = new Date();
	// Month boundary: first day 09:00 China (01:00 UTC) with 1m buffer + 30s
	const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 1, 0, 0, 0));
	const target = new Date(base.getTime() + 30_000); // +30s buffer
	const diff = target.getTime() - now.getTime();
	logDebug(`Computed next month boundary (1st 09:00 CST) in ${formatDelay(diff)} (target ${target.toISOString()}).`);
	return diff;
}

export async function runCurrentPeriodReports(): Promise<void> {
	// Generate report for the week that just ended (previous ISO week). Only call at week boundary.
	const now = new Date();
	const guildId = envParseString('MainServer_ID');
	const activeCount = await EnrolledModeratorModel.countDocuments({ guildId, active: true });
	if (activeCount === 0) {
		logInfo('No active enrolled moderators; skipping boundary weekly/monthly report generation.');
		return;
	}
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
	const wy = getISOWeekYear(yesterday);
	const wn = getISOWeekNumber(yesterday);
	await generateWeeklyReport(wy, wn);
	logInfo(`Boundary run: generated weekly report for previous week ${wy}-W${wn}.`);

	// If first day of month just started, generate previous month
	if (now.getUTCDate() === 1) {
		const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
		await generateMonthlyReport(prev.getUTCFullYear(), prev.getUTCMonth() + 1);
		logInfo(`Boundary run: generated monthly report for ${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}.`);
	}
}
