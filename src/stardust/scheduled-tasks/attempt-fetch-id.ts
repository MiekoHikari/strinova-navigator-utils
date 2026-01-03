import { prisma } from '../../_core/lib/prisma';
import { ScheduledTask } from '@sapphire/plugin-scheduled-tasks';
import { getGuild } from '../lib/utils';

interface fetchIDPayload {
	modActionDatabaseID: string;
}

export class AttemptFetchID extends ScheduledTask {
	public constructor(context: ScheduledTask.LoaderContext, options: ScheduledTask.Options) {
		super(context, {
			...options,
			name: 'attemptFetchID'
		});
	}

	public async run(payload: fetchIDPayload) {
		try {
			const entry = await prisma.modAction.findUnique({
				where: {
					id: payload.modActionDatabaseID
				}
			});

			// Only fetch if no moderatorId is set
			if (!entry || entry.moderatorId) return;
			if (!entry.performedByUsername)
				return this.container.logger.warn(
					`[Stardust][AttemptFetchID] Mod Action entry ${entry.id} has no performedByUsername to fetch ID from.`
				);

			// Skip if username has # discriminator (cannot search by that)
			if (entry.performedByUsername.includes('#')) {
				return this.container.logger.warn(
					`[Stardust][AttemptFetchID] Mod Action entry ${entry.id} has a discriminator in performedByUsername (${entry.performedByUsername}), skipping fetch.`
				);
			}

			const guild = await getGuild(process.env.MainServer_ID);

			const existingEntry = await prisma.modAction.findFirst({
				where: {
					performedByUsername: entry.performedByUsername,
					moderatorId: { not: null }
				},
				include: { moderator: true }
			});

			if (existingEntry) {
				// Link existing moderatorId
				await prisma.modAction.update({
					where: {
						id: entry.id
					},
					data: {
						moderator: {
							connect: {
								id: existingEntry.moderatorId!
							}
						}
					}
				});

				return;
			}

			// fetch member by username
			const member = await guild.members.fetch({ query: entry.performedByUsername!.replace(/^@/, ''), limit: 1 });
			if (!member.size) {
				this.container.logger.warn(
					`[Stardust][AttemptFetchID] Could not find member with username ${entry.performedByUsername} for Mod Action entry ${entry.id}.`
				);
				return;
			}

			const userId = member.first()!.user.id;

			// Create Moderator Profile if not exists and link it
			await prisma.modAction.update({
				where: {
					id: entry.id
				},
				data: {
					moderator: {
						connectOrCreate: {
							where: {
								id: userId
							},
							create: {
								user: {
									connectOrCreate: {
										where: { id: userId },
										create: {
											id: userId,
											username: member.first()!.user.username
										}
									}
								},
								active: false
							}
						}
					}
				}
			});

			this.container.logger.info(
				`[Stardust][AttemptFetchID] Successfully updated Mod Action entry ${entry.id} for ${member.first()!.user.username}.`
			);
		} finally {
			const remaining = await prisma.modAction.count({
				where: {
					moderatorId: null,
					performedByUsername: { not: null },
					NOT: { performedByUsername: { contains: '#' } }
				}
			});
			this.container.logger.info(`[Stardust][AttemptFetchID] Remaining unlinked actions: ${remaining}`);
		}
	}
}

declare module '@sapphire/plugin-scheduled-tasks' {
	interface ScheduledTasks {
		attemptFetchID: fetchIDPayload;
	}
}
