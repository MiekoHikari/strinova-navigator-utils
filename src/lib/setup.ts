// Unless explicitly defined, set NODE_ENV as development:
process.env.NODE_ENV ??= 'development';

import { ApplicationCommandRegistries, RegisterBehavior } from '@sapphire/framework';
import '@sapphire/plugin-api/register';
import '@sapphire/plugin-editable-commands/register';
import '@sapphire/plugin-logger/register';
import '@sapphire/plugin-subcommands/register';
import { envParseString, setup } from '@skyra/env-utilities';
import * as colorette from 'colorette';
import { join } from 'path';
import { inspect } from 'util';
import { srcDir } from './constants';

// Set default behavior to bulk overwrite
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite);

// Read env var
setup({ path: join(srcDir, '.env') });

// Set default commands to push out to Main Server
const mainServerID = envParseString('MainServer_ID');
ApplicationCommandRegistries.setDefaultGuildIds([mainServerID]);

// Set default inspection depth
inspect.defaultOptions.depth = 1;

// Enable colorette
colorette.createColors({ useColor: true });

declare module '@skyra/env-utilities' {
	interface Env {
		MainServer_ID: string;
		MainServer_StaffRoleID: string;
		MainServer_LeadModRoleID: string;
		MainServer_ModRoleID: string;
		MainServer_TrialModRoleID: string;
		MainServer_ModChatCategoryID: string;
		MainServer_ModCommandsCategoryID: string;
		MainServer_ModCasesChannelID: string;
		MainServer_ModMailChannelID: string;
		MainServer_ApprovalChannelID: string;
		MainServer_PointsLogChannelID: string;
		MainServer_WeeklyReportChannelID: string;
		MainServer_MonthlyReportChannelID: string;
		Statbot_Key: string;
		Mongo_URI: string;
	}
}
