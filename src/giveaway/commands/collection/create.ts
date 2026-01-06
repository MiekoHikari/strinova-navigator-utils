import { pluginCommand } from '_core/sapphire';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Channel,
	ChatInputCommandInteraction,
	Message,
	MessageActionRowComponentBuilder,
	SlashCommandSubcommandBuilder,
	TextBasedChannel
} from 'discord.js';
import { Duration } from '@sapphire/time-utilities';
import { prisma } from '_core/lib/prisma';
import { container } from '@sapphire/framework';

async function fetchAllMessages(channel: TextBasedChannel): Promise<Message[]> {
	let result: Message[] = [];
	let lastMessageId: string | undefined;

	while (true) {
		const options: { limit: number; before?: string } = { limit: 100 };
		if (lastMessageId) options.before = lastMessageId;

		const messages = await channel.messages.fetch(options);
		if (messages.size === 0) break;

		result = result.concat(Array.from(messages.values()));
		lastMessageId = messages.last()?.id;
	}

	return result;
}

async function fetchWinners(
	channel: TextBasedChannel,
	options: {
		numberOfWinners: number;
		requiresAttachment: boolean;
	}
) {
	const messages = await fetchAllMessages(channel);

	let filteredMessages = messages.slice().filter((msg) => msg.author.bot === false);
	filteredMessages = filteredMessages.filter((msg) => (options.requiresAttachment ? msg.attachments.size > 0 : true));

	const authors = new Set(filteredMessages.map((msg) => msg.author.id));

	if (options.numberOfWinners > authors.size) {
		throw new Error(`There are only ${authors.size} unique users who submitted entries when you requested ${options.numberOfWinners} winners.`);
	}

	// Shuffle messages and walk until we have the desired number of distinct authors
	const shuffledMessages = filteredMessages.slice().sort(() => Math.random() - 0.5);
	const pickedByAuthor = new Map<string, Message>();
	for (const msg of shuffledMessages) {
		if (!pickedByAuthor.has(msg.author.id)) {
			pickedByAuthor.set(msg.author.id, msg);
			if (pickedByAuthor.size === options.numberOfWinners) break;
		}
	}

	return Array.from(pickedByAuthor.values());
}

async function command(interaction: ChatInputCommandInteraction) {
	await interaction.deferReply({ flags: ['Ephemeral'] });

	// Extract all options
	const name = interaction.options.getString('name', true);
	const time = new Duration(interaction.options.getString('duration', true));
	const maxWinners = interaction.options.getInteger('max-winners', true);
	const prize = interaction.options.getString('prize', true);
	const reportingChannel = interaction.options.getChannel('reporting-channel', true) as Channel;
	const requireAttachments = interaction.options.getBoolean('require-attachments') ?? false;

	const announcementChannel = (interaction.options.getChannel('announcement-channel') as TextBasedChannel | null) ?? interaction.channel;

	if (!announcementChannel?.isSendable()) {
		return interaction.editReply('The announcement channel must be a sendable channel.');
	}

	if (time.offset <= 0) {
		return interaction.editReply('The duration must be a positive time interval. (or formatting error)');
	}

	const winners = await fetchWinners(interaction.channel!, {
		numberOfWinners: maxWinners,
		requiresAttachment: requireAttachments
	});

	const msg = await announcementChannel.send(
		`Fetched ${winners.length} winner(s) for the giveaway collection "${name}". Preparing announcement...`
	);

	// Create database entry for the giveaway collection
	const collection = await prisma.giveawayCollection.create({
		data: {
			name: name,
			prize: prize,
			endTime: new Date(Date.now() + time.offset),
			maxWinners: maxWinners,
			reportingChannelId: reportingChannel.id,
			messageId: msg.id,
			channelId: interaction.channel!.id,
			guildId: interaction.guildId!
		}
	});

	await prisma.giveawayWinner.createMany({
		data: winners.map((winner) => ({
			collectionId: collection.id,
			discordUserId: winner.author.id,
			claimed: false
		}))
	});

	const winnerMessage =
		`# The event has officially concluded! <:NovaALO:1266394121124188271>\n` +
		`Congratulations to all the winners of this event! To collect your prize, please fill out the form below this message:` +
		`\n\n${winners.map((winner, index) => `**${index + 1}.** <@${winner.author.id}> (${winner.author.username})`).join('\n')}\n\n` +
		`Please try completing this form by <t:${Math.floor((Date.now() + time.offset) / 1000)}:F> to claim your prize.\n` +
		`-# Your prizes (${prize}) will be sent out via in-game mail within 14 business days (from the expiry of the collection date). <:NovaLuxury:1266394128288321546>`;

	const actionRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
		new ButtonBuilder().setLabel('Claim Prize').setEmoji('🎁').setStyle(ButtonStyle.Primary).setCustomId(`giveaway`)
	);

	await msg.edit({ content: winnerMessage, components: [actionRow] });

	await container.tasks.create({ name: 'endGiveaway', payload: { giveaway: collection.id } }, time.offset);

	return interaction.editReply(`Giveaway collection "${name}" has been created successfully!`);
}

export default {
	sapphire: {
		name: 'create',
		chatInputRun: command
	},
	discord: new SlashCommandSubcommandBuilder()
		.setName('create')
		.setDescription('Create a new giveaway collection')
		.addStringOption((option) => option.setName('name').setDescription('The name of the collection').setRequired(true))
		.addStringOption((option) =>
			option.setName('duration').setDescription('How long to run the collection (e.g., 1h, 30m, 7 days)').setRequired(true)
		)
		.addIntegerOption((option) => option.setName('max-winners').setDescription('The maximum number of winners').setRequired(true))
		.addStringOption((option) => option.setName('prize').setDescription('The prize for the collection').setRequired(true))
		.addChannelOption((option) =>
			option.setName('reporting-channel').setDescription('The channel to send collection reports to').setRequired(true)
		)
		.addChannelOption((option) =>
			option.setName('announcement-channel').setDescription('The channel to announce the collection in').setRequired(false)
		)
		.addBooleanOption((option) =>
			option.setName('require-attachments').setDescription('Whether submissions must include attachments').setRequired(false)
		)
} as pluginCommand;
