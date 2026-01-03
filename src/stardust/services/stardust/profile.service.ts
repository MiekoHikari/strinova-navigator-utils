import { prisma } from '../../../_core/lib/prisma';

export async function ensureUser(userId: string, username: string) {
	return await prisma.user.upsert({
		where: { id: userId },
		update: { username },
		create: { id: userId, username }
	});
}

export async function getUser(userId: string) {
	return await prisma.user.findUniqueOrThrow({
		where: { id: userId }
	});
}

export async function activateEnrollment(userId: string) {
	const profile = await prisma.moderatorProfile.findUnique({ where: { id: userId } });

	if (profile?.active) throw new Error('Enrollment is already active.');

	await prisma.moderatorProfile.upsert({
		where: { id: userId },
		update: { active: true, enrolledAt: new Date() },
		create: { id: userId, active: true, enrolledAt: new Date() }
	});

	return;
}

export async function deactivateEnrollment(userId: string) {
	const profile = await prisma.moderatorProfile.findUniqueOrThrow({ where: { id: userId } });
	if (!profile.active) throw new Error('Enrollment is already inactive.');

	await prisma.moderatorProfile.update({
		where: { id: userId },
		data: { active: false }
	});

	return;
}

export async function getModeratorsList() {
	return await prisma.moderatorProfile.findMany({
		where: { active: true },
		include: { user: true }
	});
}

export async function getModeratorProfile(userId: string) {
	return await prisma.moderatorProfile.findUniqueOrThrow({
		where: { id: userId },
		include: { user: true, weeklyStats: true, modActions: true }
	});
}
