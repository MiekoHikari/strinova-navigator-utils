import { container } from '@sapphire/framework';
import { Utility } from '@sapphire/plugin-utilities-store';
import { ColorResolvable, EmbedBuilder, MessageCreateOptions, SendableChannels } from 'discord.js';

export class GuildLoggerUtility extends Utility {
	private loggerCache: Map<string, GuildLogger> = new Map();

	public constructor(context: Utility.LoaderContext, options: Utility.Options) {
		super(context, { ...options, name: 'guildLogger' });
	}

	public getLogger(): GuildLogger {
		const logger = this.loggerCache.get(process.env.MainServer_ID!);
		if (!logger) throw new Error(`Logger not found for guild ID: ${process.env.MainServer_ID}`);

		return logger;
	}

	public async addLogger(guildId: string, logChannelId: string): Promise<GuildLogger> {
		this.container.logger.debug(`[GuildLoggerUtility] Adding logger for guild ${guildId} (Channel: ${logChannelId})`);

		let logger = this.loggerCache.get(guildId);

		if (logger) {
			if (logger.channelId !== logChannelId) {
				this.container.logger.debug(`[GuildLoggerUtility] Updating channel ID for guild ${guildId}`);
				logger.setChannelId(logChannelId);
				// Reconnect with new channel
				try {
					await logger.connect();
				} catch (error) {
					this.container.logger.warn(`[GuildLoggerUtility] Failed to reconnect updated logger for guild ${guildId}:`, error);
				}
			}
			return logger;
		}

		logger = new GuildLogger(guildId, logChannelId);
		this.loggerCache.set(guildId, logger);

		// Attempt initial connection
		try {
			await logger.connect();
		} catch (error) {
			// Log but don't fail the addLogger call, allowing retry later
			this.container.logger.warn(`[GuildLoggerUtility] Initial connection failed for guild ${guildId}:`, error);
		}

		return logger;
	}

	public removeLogger(guildId: string): void {
		this.container.logger.debug(`[GuildLoggerUtility] Removing logger for guild ${guildId}`);
		this.loggerCache.delete(guildId);
	}

	public clearLoggers(): void {
		this.container.logger.info(`[GuildLoggerUtility] Clearing all loggers`);
		this.loggerCache.clear();
	}
}

export class GuildLogger {
	public connected: boolean = false;
	private guildChannel: SendableChannels | null = null;
	public guildId: string;
	public channelId: string;

	public constructor(guildId: string, logChannelId: string) {
		this.guildId = guildId;
		this.channelId = logChannelId;
	}

	public setChannelId(id: string) {
		this.channelId = id;
		this.connected = false;
		this.guildChannel = null;
	}

	/**
	 * Establishes connection to the logging channel.
	 * @param logChannelId Optional: override the stored channel ID (legacy support)
	 */
	public async Connect(logChannelId?: string) {
		if (logChannelId) this.channelId = logChannelId;
		return this.connect();
	}

	public async connect(): Promise<SendableChannels> {
		// If we have a cached channel, return it.
		// Real-world validation of "is it still valid" happens on send failure.
		if (this.connected && this.guildChannel) {
			return this.guildChannel;
		}

		try {
			const guild = await container.client.guilds.fetch(this.guildId);
			const channel = await guild.channels.fetch(this.channelId);

			if (!channel) throw new Error(`Channel with ID: ${this.channelId} not found in Guild ID: ${this.guildId}.`);
			if (!channel.isSendable()) throw new Error(`Channel with ID: ${this.channelId} is not sendable.`);

			this.connected = true;
			this.guildChannel = channel;
			container.logger.info(`[GuildLogger:${this.guildId}] Connected to channel ${this.channelId}`);
			return this.guildChannel;
		} catch (error) {
			this.connected = false;
			this.guildChannel = null;
			container.logger.error(`[GuildLogger:${this.guildId}] Connection failed`, error);
			throw error;
		}
	}

	public async log(message: string | MessageCreateOptions | EmbedBuilder) {
		try {
			const channel = await this.connect();

			let payload: MessageCreateOptions;
			if (typeof message === 'string') {
				payload = { content: message };
			} else if (message instanceof EmbedBuilder) {
				payload = { embeds: [message] };
			} else {
				payload = message;
			}

			await channel.send(payload);
		} catch (error) {
			container.logger.error(`[GuildLogger:${this.guildId}] Failed to send log message`, error);
			// Invalidate connection on error so next attempt tries to reconnect
			this.connected = false;
			this.guildChannel = null;
		}
	}

	public async info(title: string, messageContent: string) {
		// Diamond
		return this.sendEmbed(title, messageContent, '#b9f2ff');
	}

	public async warn(title: string, messageContent: string) {
		// Gold
		return this.sendEmbed(title, messageContent, '#ffe05c');
	}

	public async error(title: string, messageContent: string) {
		// Redstone
		return this.sendEmbed(title, messageContent, '#ff5c5c');
	}

	public async success(title: string, messageContent: string) {
		// Emerald
		return this.sendEmbed(title, messageContent, '#5cd65c');
	}

	private async sendEmbed(title: string, messageContent: string, color: ColorResolvable) {
		const embed = new EmbedBuilder().setFooter({ text: title }).setColor(color).setTimestamp();

		return this.log({ content: messageContent, embeds: [embed] });
	}
}

declare module '@sapphire/plugin-utilities-store' {
	export interface Utilities {
		guildLogger: GuildLoggerUtility;
	}
}
