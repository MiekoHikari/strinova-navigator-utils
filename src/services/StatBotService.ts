import { container } from '@sapphire/framework';

export interface StatBotSeries {
	count: number;
	unixTimestamp: number;
}

export class StatBotService {
	private appendParamsToUrl(url: string, params: Record<string, unknown>): string {
		const [path, existingQuery = ''] = url.split('?');
		const search = new URLSearchParams(existingQuery);

		const append = (key: string, value: unknown) => {
			if (value === undefined || value === null) return;
			if (Array.isArray(value)) {
				for (const v of value) append(key, v);
			} else {
				search.append(key, String(value));
			}
		};

		for (const [key, value] of Object.entries(params)) {
			append(key, value);
		}

		const queryString = search.toString();
		return queryString ? `${path}?${queryString}` : path;
	}

	public async fetchSeries(url: string, params: Record<string, unknown>): Promise<StatBotSeries[]> {
		const client = container.statBotClient;
		if (!client) throw new Error('StatBot client not initialized');
		const res = await client.get<StatBotSeries[]>(this.appendParamsToUrl(url, params));
		return res.data;
	}
}
