import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ActionRowBuilder, Attachment, AttachmentBuilder, ButtonBuilder, ButtonStyle, GuildMember, MessageActionRowComponentBuilder } from 'discord.js';
import { parse } from 'csv-parse/sync';
import axios from 'axios';

@ApplyOptions<Command.Options>({
	description: 'Assign a role to multiple users from a spreadsheet',
	requiredUserPermissions: ['ManageRoles']
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addAttachmentOption((option) =>
					option //
						.setName('csv-file')
						.setDescription('The CSV file containing user data')
						.setRequired(true)
				)
				.addRoleOption((option) =>
					option //
						.setName('role')
						.setDescription('The role to assign to the users')
						.setRequired(true)
				)
				.addStringOption((option) =>
					option //
						.setName('id-type')
						.setDescription('The type of identifier used in the spreadsheet (e.g., user ID, username)')
						.setRequired(true)
						.addChoices({ name: 'User ID', value: 'user_id' }, { name: 'Username', value: 'username' })
				)
				.addStringOption((option) =>
					option //
						.setName('column')
						.setDescription('The column name where user IDs or usernames are located')
						.setRequired(false)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply();

		// Parse all options
		const csvFile = interaction.options.getAttachment('csv-file', true);
		const column = interaction.options.getString('column');
		const role = interaction.options.getRole('role', true);
		const idType = interaction.options.getString('id-type', true);

		const users = await this.parseCSVColumn(csvFile, column);

		const confirmation = await this.columnConfirmation(interaction, role.name, users);
		if (!confirmation) return;

		const { assignable, unassignable } = await this.parseUsers(interaction, users, idType as 'user_id' | 'username');

		const assignConfirmation = await this.assignConfirmation(interaction, role.name, assignable.map(u => u.user.tag), unassignable);
		if (!assignConfirmation) return;

		const failed: {
			user: string;
			reason: string;
		}[] = [];

		// Assign role to all assignable users
		assignable.forEach(async (member) => {
			try {
				await member.roles.add(role.id);
			} catch (error) {
				console.error(`Failed to assign role to ${member.user.tag}:`, error);
				failed.push({ user: member.user.tag, reason: (error as Error).message });
			}
		})

		// Final report
		const successCount = assignable.length - failed.length;
		const failureCount = unassignable.length + failed.length;

		const finalMessage = `Role assignment complete! ${successCount} users were assigned the role **${role.name}**. ${failureCount} users could not be assigned the role.`;

		// Convert failed users to csv for attachment
		const failedCsv = [ 'User,Reason', ...failed.map(u => `${u.user},${u.reason}`)].join('\n');
		const failedAttachment = new AttachmentBuilder(Buffer.from(failedCsv), { name: 'failed_users.csv' });

		await interaction.followUp({
			content: finalMessage,
			files: [failedAttachment]
		});
	}

	private async parseCSVColumn(attachment: Attachment, column?: string | null): Promise<string[]> {
		const hasColumn = Boolean(column);

		const file = await axios.get(attachment.url);

		const records = parse(file.data, { columns: hasColumn, skip_empty_lines: true });

		if (column) {
			return records.map((record: any) => record[column]).filter((value: string) => value);
		} else {
			const firstColumn = Object.keys(records[0])[0];
			return records.map((record: any) => record[firstColumn]).filter((value: string) => value);
		}
	}

	private async columnConfirmation(interaction: Command.ChatInputCommandInteraction, roleName: string, users: string[]) {
		// Ask for confirmation before proceeding
		const uid = Date.now();

		// Show sample data from detected column
		const sampleSize = Math.min(5, users.length);
		const sampleData = users.slice(0, sampleSize);
		const sampleDisplay = sampleData.map((user, idx) => `${idx + 1}. \`${user}\``).join('\n');
		const hasMore = users.length > sampleSize;

		const confirmationMessage = [
			`**Detected ${users.length} user(s) in the selected column.**`,
			'',
			'**Sample data:**',
			sampleDisplay,
			hasMore ? `... and ${users.length - sampleSize} more` : '',
			'',
			`Are you sure you want to assign the role **${roleName}** to these users?`
		].join('\n');

		const confirmationInteraction = await interaction.followUp({
			content: confirmationMessage,
			components: [
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder().setCustomId(`confirm_${uid}`).setLabel('Confirm').setStyle(ButtonStyle.Primary),
					new ButtonBuilder().setCustomId(`cancel_${uid}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
				)
			]
		});

		const filter = (i: any) => i.user.id === interaction.user.id && i.customId.endsWith(`${uid}`);

		const collected = await confirmationInteraction.awaitMessageComponent({ filter, time: 60000 });

		if (collected.customId === `cancel_${uid}`) {
			await collected.update({ content: 'Operation cancelled.', components: [] });
			return false;
		}

		await collected.update({ content: 'Operation confirmed. Proceeding...', components: [] });
		return true;
	}

	private async parseUsers(interaction: Command.ChatInputCommandInteraction, users: string[], idType: 'user_id' | 'username'): Promise<{ assignable: GuildMember[], unassignable: {user: string, reason: string}[] }> {
		const assignable: GuildMember[] = [];
		const unassignable: {user: string, reason: string}[] = [];

		for (const rawUser of users) {
			const user = rawUser.trim();
			let guildMember: GuildMember | null = null;
			const guild = interaction.guild;
			if (!guild) {
				unassignable.push({ user, reason: 'No guild context' });
				continue;
			}

			// Convert username to ID if necessary
			if (idType === 'username') {
				const lookup = await this.lookupUsername(interaction, user);
				if (!lookup) {
					unassignable.push({ user, reason: 'Username could not be matched' });
					continue;
				} else {
					guildMember = lookup;
				}
			}

			// Check if user is banned
			let isBanned = false;
			try {
				const fetchId = guildMember ? guildMember.id : user;
				const ban = await guild.bans.fetch(fetchId).catch(() => null);
				isBanned = Boolean(ban);
			} catch {
				isBanned = false;
			}

			if (isBanned) {
				unassignable.push({ user, reason: 'User is banned from the server' });
				continue;
			}

			// Fetch guild member
			try {
				guildMember = guildMember || (await guild.members.fetch(user).catch(() => null));
				if (guildMember) {
					assignable.push(guildMember);
				} else {
					unassignable.push({ user, reason: 'User not found in the server' });
				}
			} catch {
				unassignable.push({ user, reason: 'User not found in the server' });
			}
		}

		return { assignable, unassignable };
	}

	private async lookupUsername(interaction: Command.ChatInputCommandInteraction, username: string) {
		const guild = interaction.guild;
		if (!guild) return null;

		const members = await guild.members.fetch({ query: username, limit: 1 });
		return members.first() || null;
	}

	private async assignConfirmation(interaction: Command.ChatInputCommandInteraction, roleName: string, assignedUsers: string[], unassignedUsers: {user: string, reason: string}[]) {
		// Ask for confirmation before proceeding
		const uid = Date.now();

		const confirmationMessage = `${assignedUsers.length} users will be assigned the role **${roleName}**.\n${unassignedUsers.length} users could not be assigned the role. Proceed?`;
		
		// Convert unassigned users to csv for attachment
		const unassignedCsv = [ 'User,Reason', ...unassignedUsers.map(u => `${u.user},${u.reason}`)].join('\n');
		const unassignedAttachment = new AttachmentBuilder(Buffer.from(unassignedCsv), { name: 'unassigned_users.csv' });

		const confirmationInteraction = await interaction.followUp({
			content: confirmationMessage,
			components: [
				new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
					new ButtonBuilder().setCustomId(`assign_confirm_${uid}`).setLabel('Confirm').setStyle(ButtonStyle.Primary),
					new ButtonBuilder().setCustomId(`assign_cancel_${uid}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
				)
			],
			files: [unassignedAttachment]
		});

		const filter = (i: any) => i.user.id === interaction.user.id && i.customId.endsWith(`${uid}`);

		const collected = await confirmationInteraction.awaitMessageComponent({ filter, time: 60000 });

		if (collected.customId === `assign_cancel_${uid}`) {
			await collected.update({ content: 'Role assignment cancelled.', components: [] });
			return false;
		}

		await collected.update({ content: 'Role assignment confirmed. Proceeding...', components: [] });
		return true;
	}
}
