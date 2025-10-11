import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { Message } from 'discord.js';

@ApplyOptions<Command.Options>({
	description: 'Get a random amount of users in a channel',
	requiredUserPermissions: ['ManageMessages'],
})
export class UserCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder //
				.setName(this.name)
				.setDescription(this.description)
				.addIntegerOption((option) =>
					option //
						.setName('amount')
						.setDescription('The amount of users to pull')
						.setMinValue(1)
						.setMaxValue(100)
						.setRequired(true)
				)
				.addBooleanOption((option) =>
					option //
						.setName('unique')
						.setDescription('Whether to pull unique users only')
						.setRequired(false)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });

		const amount = interaction.options.getInteger('amount', true);
		const unique = interaction.options.getBoolean('unique') ?? false;

		const channel = interaction.channel;
		if (!channel || !channel.isTextBased()) {
			return interaction.editReply('This command can only be used in text-based channels.');
		}

		// Loop to fetch all messages in the channel until there are no more messages to fetch
		let allMessages: Message[] = [];
		let lastMessageId: string | undefined;
		while (true) {
			const options: { limit: number; before?: string } = { limit: 100 };
			if (lastMessageId) options.before = lastMessageId;

			const messages = await channel.messages.fetch(options);
			if (messages.size === 0) break;

			allMessages = allMessages.concat(Array.from(messages.values()));
			lastMessageId = messages.last()?.id;
		}

		if (allMessages.length === 0) {
			return interaction.editReply('No messages found in this channel.');
		}

		let users = allMessages.map((msg) => msg.author);
		if (unique) {
			users = Array.from(new Set(users.map((user) => user.id))).map((id) => users.find((user) => user.id === id)!);
		}

		if (users.length === 0) {
			return interaction.editReply('No users found in this channel.');
		}

		if (amount > users.length) {
			return interaction.editReply(`There are only ${users.length} unique users in this channel.`);
		}

		const shuffled = users.sort(() => 0.5 - Math.random());
		const selected = shuffled.slice(0, amount);

		return interaction.editReply(
			`Pulled ${selected.length} user(s):\n${selected.map((user) => `- ${user.tag} (${user.id})`).join('\n')}`
		);
	}
}
