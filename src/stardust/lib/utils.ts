import { container } from '@sapphire/framework';
import type { Guild } from 'discord.js';

export async function getWeekRange(month: number, year: number) {
	const firstDayOfMonth = new Date(year, month - 1, 1);
	const lastDayOfMonth = new Date(year, month, 0);

	const startWeek = getISOWeekNumber(firstDayOfMonth);
	const endWeek = getISOWeekNumber(lastDayOfMonth);

	if (endWeek < startWeek) {
		const weeksInYear = getISOWeekNumber(new Date(year, 11, 28));
		return { startWeek, endWeek: weeksInYear };
	}

	return { startWeek, endWeek };
}

export function getISOWeekNumber(date: Date) {
	const tempDate = new Date(date.getTime());

	tempDate.setHours(0, 0, 0, 0);
	tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));

	const yearStart = new Date(tempDate.getFullYear(), 0, 1);
	return Math.ceil(((tempDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getLastWeek(week: number, year: number) {
	if (week === 1) {
		year--;
		week = getISOWeekNumber(new Date(year, 11, 28));
	} else {
		week--;
	}

	return { week, year };
}

export function getDateFromWeekNumber(week: number, year: number, type: 'start' | 'end'): Date {
	const firstDayOfYear = new Date(year, 0, 1);
	const daysOffset = (week - 1) * 7;
	const targetDate = new Date(firstDayOfYear.getTime() + daysOffset * 86400000);

	const dayOfWeek = targetDate.getDay();
	const diffToMonday = (dayOfWeek + 6) % 7;
	targetDate.setDate(targetDate.getDate() - diffToMonday);

	if (type === 'end') {
		targetDate.setDate(targetDate.getDate() + 6);
		targetDate.setHours(23, 59, 59, 999);
	}

	return targetDate;
}

export async function getGuild(guildId: string) {
	return container.client.guilds.fetch(guildId);
}

export async function getChannelsInCategory(guild: Guild, categoryId: string) {
	const channels = await guild.channels.fetch();
	return channels.filter((c) => c?.parentId === categoryId).map((c) => c!.id);
}
