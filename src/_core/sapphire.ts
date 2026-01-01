import { SapphireClient } from '@sapphire/framework';
import { container, getRootData } from '@sapphire/pieces';
import type { ClientOptions, SlashCommandSubcommandBuilder } from 'discord.js';
import { join } from 'path';
import { existsSync } from 'fs';
import { SubcommandMappingMethod } from '@sapphire/plugin-subcommands';
import { createStatBotClient, StatBotClient } from './lib/api/statbotClient';
import { prisma } from './lib/prisma';

export interface pluginCommand {
	sapphire: SubcommandMappingMethod;
	discord: SlashCommandSubcommandBuilder;
}

export class StrinovaSapphireClient extends SapphireClient {
	private rootData = getRootData();
	private extensions: string[] = [];

	public constructor(options: ClientOptions, extensions: string[] = []) {
		super(options);
		this.extensions = extensions;

		const commandStore = this.stores.get('commands');

		for (const extension of this.extensions) {
			const path = join(this.rootData.root, extension);
			if (existsSync(path)) {
				this.stores.registerPath(path);
			}
		}
		commandStore.paths.clear();

		this.logger.info('Sapphire Client initialized');
	}

	public override async login(token?: string): Promise<string> {
		const statBotClient = createStatBotClient({ baseURL: 'https://api.statbot.net/v1', apiKey: process.env.Statbot_Key });
		container.statBotClient = statBotClient;

		try {
			await prisma.$connect();
			this.logger.info('Connected to SQLite via Prisma');
		} catch (error) {
			this.logger.fatal('Failed to connect to Database', error);
			process.exit(1);
		}

		const loggedInToken = await super.login(token);
		this.logger.info('Sapphire Client logged in!');

		this.logger.debug('Attempting to load commands...');
		const commandStore = this.stores.get('commands');

		for (const extension of this.extensions) {
			const path = join(this.rootData.root, extension);

			if (existsSync(path)) {
				this.stores.registerPath(path);

				if (existsSync(join(path, 'commands', 'route.js'))) {
					await commandStore.load(join(path, 'commands'), 'route.js');
				} else {
					commandStore.registerPath(join(path, 'commands'));
				}
			} else {
				console.warn(`Extension path does not exist: ${extension}`);
			}
		}

		this.stores.register(commandStore);

		return loggedInToken;
	}
}

declare module '@sapphire/framework' {
	interface Container {
		statBotClient: StatBotClient;
	}
}
