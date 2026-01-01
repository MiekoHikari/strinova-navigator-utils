export async function getWeekRange(month: number, year: number) {
	const firstDayOfMonth = new Date(year, month - 1, 1);
	const lastDayOfMonth = new Date(year, month, 0);

	const startWeek = getISOWeekNumber(firstDayOfMonth);
	const endWeek = getISOWeekNumber(lastDayOfMonth);

	return { startWeek, endWeek };
}
function getISOWeekNumber(date: Date) {
	const tempDate = new Date(date.getTime());

	tempDate.setHours(0, 0, 0, 0);
	tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));

	const yearStart = new Date(tempDate.getFullYear(), 0, 1);
	return Math.ceil(((tempDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
