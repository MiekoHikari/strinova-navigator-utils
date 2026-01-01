import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';

/**
 * Rate limit metadata extracted from response headers.
 */
export interface RateLimitInfo {
	limit: number | null;
	remaining: number | null;
	/** seconds until reset from the response header */
	reset: number | null;
	/** absolute time when the rate limit resets */
	resetAt: Date | null;
	/** seconds to wait if provided explicitly */
	retryAfter: number | null;
}

export interface StatBotClientOptions {
	baseURL: string;
	apiKey: string;
	timeoutMs?: number;
	userAgent?: string;
	/** Maximum automatic retries on 429 or transient network errors */
	maxRetries?: number;
}

/**
 * A minimal Axios-based client for the StatBot API with Bearer auth and rate limit handling.
 */
export class StatBotClient {
	public readonly axios: AxiosInstance;
	public rateLimit: RateLimitInfo = {
		limit: null,
		remaining: null,
		reset: null,
		resetAt: null,
		retryAfter: null
	};

	private readonly maxRetries: number;

	constructor(options: StatBotClientOptions) {
		const { baseURL, apiKey, timeoutMs = 15000, userAgent, maxRetries = 2 } = options;
		this.maxRetries = Math.max(0, maxRetries);

		const headers: Record<string, string> = {
			Authorization: `Bearer ${apiKey}`
		};
		if (userAgent) headers['User-Agent'] = userAgent;

		this.axios = axios.create({ baseURL, timeout: timeoutMs, headers });

		// Request interceptor: delay if we know we're rate limited.
		this.axios.interceptors.request.use(async (config) => {
			await this.waitIfRateLimited();
			return config;
		});

		// Response interceptor: parse rate limit headers and update state.
		this.axios.interceptors.response.use(
			(response) => {
				this.updateRateLimitFromResponse(response);
				return response;
			},
			async (error: AxiosError) => {
				const response = error.response as AxiosResponse | undefined;
				if (!response) {
					// Network or CORS error; optionally retry with small backoff
					const cfg = (error.config || {}) as AxiosRequestConfig & { __retryCount?: number };
					if ((cfg.__retryCount ?? 0) < this.maxRetries) {
						cfg.__retryCount = (cfg.__retryCount ?? 0) + 1;
						await sleep(500 * cfg.__retryCount);
						return this.axios.request(cfg);
					}
					throw error;
				}

				// Update internal rate limit state from the error response headers.
				this.updateRateLimitFromResponse(response);

				// Handle 400 Bad Request: surface API validation message for easier debugging.
				if (response.status === 400) {
					const apiMsg = extractApiErrorMessage(response.data);
					if (apiMsg) {
						// eslint-disable-next-line no-console
						console.error(`[StatBotClient] 400 Bad Request: ${apiMsg}`);
						// Augment the thrown error message so upstream handlers see the API-provided details.
						try {
							(error as any).apiMessage = apiMsg;
							if (!error.message.includes(apiMsg)) {
								error.message = `${error.message} - ${apiMsg}`;
							}
						} catch {
							/* noop */
						}
					}
				}

				// Handle 429 Too Many Requests: respect Retry-After or x-ratelimit-reset and retry.
				if (response.status === 429) {
					const cfg = (error.config || {}) as AxiosRequestConfig & { __retryCount?: number };
					const retryCount = cfg.__retryCount ?? 0;
					if (retryCount < this.maxRetries) {
						cfg.__retryCount = retryCount + 1;
						const waitSeconds = this.rateLimit.retryAfter ?? this.rateLimit.reset ?? 1;
						await sleep((waitSeconds + jitter()) * 1000);
						return this.axios.request(cfg);
					}
				}

				throw error;
			}
		);
	}

	/** Generic request wrapper with types. */
	async request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
		return this.axios.request<T>(config);
	}

	// Convenience HTTP verbs
	get<T = unknown>(url: string, config?: AxiosRequestConfig) {
		return this.request<T>({ ...config, method: 'GET', url });
	}

	post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
		return this.request<T>({ ...config, method: 'POST', url, data });
	}

	put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
		return this.request<T>({ ...config, method: 'PUT', url, data });
	}

	patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
		return this.request<T>({ ...config, method: 'PATCH', url, data });
	}

	delete<T = unknown>(url: string, config?: AxiosRequestConfig) {
		return this.request<T>({ ...config, method: 'DELETE', url });
	}

	/**
	 * If we previously observed remaining <= 0 and resetAt is in the future, wait until reset.
	 */
	private async waitIfRateLimited(): Promise<void> {
		const { remaining, resetAt } = this.rateLimit;
		if (remaining !== null && remaining <= 0 && resetAt) {
			const ms = resetAt.getTime() - Date.now();
			if (ms > 0) {
				await sleep(ms + jitter() * 1000);
			}
		}
	}

	private updateRateLimitFromResponse(response: AxiosResponse): void {
		const headers = lowerCaseKeys(response.headers || {});
		const limit = parseIntSafe(headers['x-ratelimit-limit']);
		const remaining = parseIntSafe(headers['x-ratelimit-remaining']);
		const resetSec = parseIntSafe(headers['x-ratelimit-reset']);
		const retryAfter = parseIntSafe(headers['retry-after']);

		this.rateLimit.limit = Number.isFinite(limit) ? (limit as number) : this.rateLimit.limit;
		this.rateLimit.remaining = Number.isFinite(remaining) ? (remaining as number) : this.rateLimit.remaining;
		this.rateLimit.reset = Number.isFinite(resetSec) ? (resetSec as number) : this.rateLimit.reset;
		this.rateLimit.retryAfter = Number.isFinite(retryAfter) ? (retryAfter as number) : null;
		this.rateLimit.resetAt = Number.isFinite(resetSec) ? new Date(Date.now() + (resetSec as number) * 1000) : this.rateLimit.resetAt;
	}
}

// Utilities
function parseIntSafe(value: unknown): number | null {
	if (value == null) return null;
	const n = parseInt(String(value), 10);
	return Number.isFinite(n) ? n : null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function jitter(): number {
	// 0-0.2s jitter in seconds to avoid thundering herd
	return Math.random() * 0.2;
}

function lowerCaseKeys<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v;
	return out;
}

function extractApiErrorMessage(data: unknown): string | undefined {
	if (!data) return undefined;
	// Typical shape { statusCode: 400, error: 'Bad Request', message: '...' }
	if (typeof data === 'object') {
		const maybe = data as any;
		if (typeof maybe.message === 'string') return maybe.message;
		// Some APIs nest error details
		if (maybe.error && typeof maybe.error === 'object' && typeof maybe.error.message === 'string') return maybe.error.message;
	}
	if (typeof data === 'string') return data;
	return undefined;
}

/**
 * Helper factory to create a client.
 */
export function createStatBotClient(options: StatBotClientOptions): StatBotClient {
	return new StatBotClient(options);
}
