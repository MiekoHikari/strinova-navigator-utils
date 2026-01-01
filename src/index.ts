import { createStatBotClient, StatBotClient } from '#lib/api/statbotClient';
import { envParseString } from '@skyra/env-utilities';
import './lib/setup';

import { container, LogLevel, SapphireClient } from '@sapphire/framework';
import { IntentsBitField, Partials } from 'discord.js';
import { prisma } from './lib/prisma';

const client = new SapphireClient({
	logger: {
		level: LogLevel.Debug
	},
	intents: [
		IntentsBitField.Flags.Guilds,
		IntentsBitField.Flags.GuildMessages,
		IntentsBitField.Flags.GuildModeration,
		IntentsBitField.Flags.MessageContent,
		IntentsBitField.Flags.GuildVoiceStates
	],
	partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember]
});

const main = async () => {
	try {
		// Initialize statbot client
		const statBotClient = createStatBotClient({ baseURL: 'https://api.statbot.net/v1', apiKey: envParseString('Statbot_Key') });
		container.statBotClient = statBotClient;

		// Connect to Database
		try {
			await prisma.$connect();
			client.logger.info('Connected to SQLite via Prisma');
		} catch (error) {
			client.logger.fatal('Failed to connect to Database', error);
			process.exit(1);
		}

		client.logger.info('Logging in');
		await client.login();
		client.logger.info('Logged in');
	} catch (error) {
		client.logger.fatal(error);
		await client.destroy();
		process.exit(1);
	}
};

declare module '@sapphire/framework' {
	interface Container {
		statBotClient: StatBotClient;
	}
}

void main();
