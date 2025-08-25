import { Precondition } from '@sapphire/framework';
import { envParseString } from '@skyra/env-utilities';
import type { ChatInputCommandInteraction, ContextMenuCommandInteraction } from 'discord.js';

const serverID = envParseString('MainServer_ID');
const roleID = envParseString('MainServer_StaffRoleID');

export class UserPrecondition extends Precondition {
	public override async chatInputRun(interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) {
			return this.error({ message: 'This command can only be used in a server.' });
		} else if (!interaction.member) {
			return this.error({ message: 'This command can only be used by a member.' });
		} else if (interaction.guild.id !== serverID) {
			return this.error({ message: 'This command can only be used in the main server.' });
		}

		const guild = await interaction.guild.fetch();
		const member = await guild.members.fetch(interaction.user.id);
		const hasRequiredRole = member.roles.cache.has(roleID);

		if (!hasRequiredRole) {
			return this.error({ message: 'You do not have the required role to use this command.' });
		}

		return this.ok();
	}

	public override async contextMenuRun(interaction: ContextMenuCommandInteraction) {
		if (!interaction.guild) {
			return this.error({ message: 'This command can only be used in a server.' });
		} else if (!interaction.member) {
			return this.error({ message: 'This command can only be used by a member.' });
		} else if (interaction.guild.id !== serverID) {
			return this.error({ message: 'This command can only be used in the main server.' });
		}

		const guild = await interaction.guild.fetch();
		const member = await guild.members.fetch(interaction.user.id);
		const hasRequiredRole = member.roles.cache.has(roleID);

		if (!hasRequiredRole) {
			return this.error({ message: 'You do not have the required role to use this command.' });
		}

		return this.ok();
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		staffOnly: never;
	}
}
