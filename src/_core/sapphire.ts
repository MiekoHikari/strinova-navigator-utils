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

		// Register non-command stores for extensions with route files BEFORE super.login()
		const commandStore = this.stores.get('commands');

		for (const extension of this.extensions) {
			const path = join(this.rootData.root, extension);

			if (existsSync(path)) {
				const hasRouteFile = existsSync(join(path, 'commands', 'route.js'));

				if (hasRouteFile) {
					// Register paths for all stores EXCEPT commands when using custom route loader
					for (const store of this.stores.values()) {
						if (store.name !== 'commands') {
							store.registerPath(join(path, store.name));
						}
					}
				} else {
					// No route file - register all stores including commands normally
					this.stores.registerPath(path);
				}
			} else {
				console.warn(`Extension path does not exist: ${extension}`);
			}
		}

		// Login first - this loads all stores from registered paths
		const loggedInToken = await super.login(token);

		// Now load custom route commands AFTER super.login() has completed
		this.logger.debug('Loading custom route commands...');
		for (const extension of this.extensions) {
			const path = join(this.rootData.root, extension);

			if (existsSync(path)) {
				const hasRouteFile = existsSync(join(path, 'commands', 'route.js'));

				if (hasRouteFile) {
					const routePath = join(path, 'commands', 'route.js');
					this.logger.debug(`Loading route from: ${routePath}`);
					try {
						await commandStore.load(join(path, 'commands'), 'route.js');
						this.logger.debug(`Command store size after load: ${commandStore.size}`);
					} catch (error) {
						this.logger.error(`Failed to load route:`, error);
					}
				}
			}
		}

		this.logger.info('Sapphire Client logged in!');

		return loggedInToken;
	}
}

declare module '@sapphire/framework' {
	interface Container {
		statBotClient: StatBotClient;
	}
}
