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
				.addBooleanOption((option) =>
					option //
						.setName('requires_attachment')
						.setDescription('Only consider messages that contain at least one attachment')
						.setRequired(false)
				)
				.addIntegerOption((option) =>
					option //
						.setName('min_characters')
						.setDescription('Only consider messages with at least this many characters')
						.setMinValue(1)
						.setMaxValue(4000)
						.setRequired(false)
				)
				.addBooleanOption((option) =>
					option //
						.setName('exclude_bots')
						.setDescription('Exclude bot-authored messages from consideration')
						.setRequired(false)
				)
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: ['Ephemeral'] });

		const amount = interaction.options.getInteger('amount', true);
		const unique = interaction.options.getBoolean('unique') ?? false;
		const requiresAttachment = interaction.options.getBoolean('requires_attachment') ?? false;
		const minCharacters = interaction.options.getInteger('min_characters') ?? undefined;
		const excludeBots = interaction.options.getBoolean('exclude_bots') ?? false;

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

		// Apply filters
		let filteredMessages = allMessages.slice();
		if (excludeBots) filteredMessages = filteredMessages.filter((m) => !m.author.bot);
		if (requiresAttachment) filteredMessages = filteredMessages.filter((m) => m.attachments.size > 0);
		if (typeof minCharacters === 'number') filteredMessages = filteredMessages.filter((m) => m.content.trim().length >= minCharacters);

		if (filteredMessages.length === 0) {
			return interaction.editReply('No messages matched the provided filters.');
		}

		// When unique is requested, ensure we only select distinct authors, and keep
		// the message that caused their selection so we can return its link.
		if (unique) {
			const uniqueAuthorCount = new Set(filteredMessages.map((m) => m.author.id)).size;
			if (amount > uniqueAuthorCount) {
				return interaction.editReply(`There are only ${uniqueAuthorCount} unique users matching the filters in this channel.`);
			}

			// Shuffle messages and walk until we have the desired number of distinct authors
			const shuffledMessages = filteredMessages.slice().sort(() => Math.random() - 0.5);
			const pickedByAuthor = new Map<string, Message>();
			for (const msg of shuffledMessages) {
				if (!pickedByAuthor.has(msg.author.id)) {
					pickedByAuthor.set(msg.author.id, msg);
					if (pickedByAuthor.size === amount) break;
				}
			}

			const selectedMessages = Array.from(pickedByAuthor.values());
			return interaction.editReply(
				`Pulled ${selectedMessages.length} user(s) from ${filteredMessages.length} filtered message(s):\n` +
					selectedMessages.map((m) => `- ${m.author.tag} — ${m.url}`).join('\n')
			);
		}

		// Not unique: select random messages directly (users may repeat)
		if (amount > filteredMessages.length) {
			return interaction.editReply(`There are only ${filteredMessages.length} messages available after applying filters in this channel.`);
		}

		const shuffledMessages = filteredMessages.slice().sort(() => Math.random() - 0.5);
		const selectedMessages = shuffledMessages.slice(0, amount);
		return interaction.editReply(
			`Pulled ${selectedMessages.length} user(s) from ${filteredMessages.length} filtered message(s):\n` +
				selectedMessages.map((m) => `- ${m.author.tag} — ${m.url}`).join('\n')
		);
	}
}
