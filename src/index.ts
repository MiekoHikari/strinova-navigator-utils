import './_core/lib/setup';

import { LogLevel } from '@sapphire/framework';
import { IntentsBitField, Partials } from 'discord.js';
import { StrinovaSapphireClient } from '_core/sapphire';

const client = new StrinovaSapphireClient(
	{
		logger: {
			level: LogLevel.Debug
		},
		shards: 'auto',
		intents: [
			IntentsBitField.Flags.Guilds,
			IntentsBitField.Flags.GuildMessages,
			IntentsBitField.Flags.GuildModeration,
			IntentsBitField.Flags.MessageContent,
			IntentsBitField.Flags.GuildVoiceStates,
			IntentsBitField.Flags.GuildMembers
		],
		partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember],
		tasks: {
			bull: {
				connection: {
					host: 'localhost',
					port: 6379
				}
			}
		}
	},
	['_core', 'stardust', 'giveaway']
);

const main = async () => {
	try {
		client.logger.info('Logging in');
		await client.login();
		client.logger.info('Logged in');
	} catch (error) {
		client.logger.fatal(error);
		await client.destroy();
		process.exit(1);
	}
};

void main();
