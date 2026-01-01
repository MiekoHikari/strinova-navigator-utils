import { prisma } from '#lib/prisma';

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
	const profile = await prisma.moderatorProfile.findUnique({ where: { userId } });

	if (profile?.active) throw new Error('Enrollment is already active.');

	await prisma.moderatorProfile.upsert({
		where: { userId },
		update: { active: true, enrolledAt: new Date() },
		create: { userId, active: true, enrolledAt: new Date() }
	});

	return;
}

export async function deactivateEnrollment(userId: string) {
	const profile = await prisma.moderatorProfile.findUniqueOrThrow({ where: { userId } });
	if (!profile.active) throw new Error('Enrollment is already inactive.');

	await prisma.moderatorProfile.update({
		where: { userId },
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
