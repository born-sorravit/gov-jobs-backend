import { CacheConfig } from "@/config/configuration";
import { Redis } from "@upstash/redis";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface MemoryEntry {
	value: unknown;
	expiresAt: number;
}

/**
 * A small read-through cache.
 *
 * Upstash over its **REST** API, not a TCP client: there is no socket to hold, it works from
 * any runtime, and cache traffic is low enough to stay inside the free tier. (Queues could
 * not use Redis for exactly the opposite reason — see the README.)
 *
 * With no credentials it degrades to an in-process Map, so local development and CI need no
 * network service and nothing has to branch on whether a cache exists.
 */
@Injectable()
export class CacheService implements OnModuleInit {
	private readonly logger = new Logger(CacheService.name);
	private readonly config: CacheConfig;
	private readonly memory = new Map<string, MemoryEntry>();
	private redis: Redis | null = null;

	constructor(configService: ConfigService) {
		this.config = configService.getOrThrow<CacheConfig>("cache");
	}

	onModuleInit(): void {
		if (
			this.config.provider === "upstash" &&
			this.config.restUrl &&
			this.config.restToken
		) {
			this.redis = new Redis({
				url: this.config.restUrl,
				token: this.config.restToken,
			});
			this.logger.log("Cache: Upstash REST");
			return;
		}
		this.logger.log("Cache: in-process (no Upstash credentials configured)");
	}

	/**
	 * Returns the cached value, or computes and stores it.
	 *
	 * A cache failure is never allowed to fail the request — the point of a cache is to be
	 * optional. A miss and an outage look the same to the caller.
	 */
	async remember<T>(
		key: string,
		factory: () => Promise<T>,
		ttlSeconds?: number
	): Promise<T> {
		const ttl = ttlSeconds ?? this.config.ttlSeconds;
		const namespaced = `${this.config.prefix}:${key}`;

		const cached = await this.read<T>(namespaced);
		if (cached !== undefined) return cached;

		const value = await factory();
		await this.write(namespaced, value, ttl);
		return value;
	}

	async forget(key: string): Promise<void> {
		const namespaced = `${this.config.prefix}:${key}`;
		this.memory.delete(namespaced);

		if (this.redis) {
			await this.redis.del(namespaced).catch((error: Error) => {
				this.logger.warn(`Cache delete failed for ${key}: ${error.message}`);
			});
		}
	}

	private async read<T>(key: string): Promise<T | undefined> {
		if (this.redis) {
			try {
				const value = await this.redis.get<T>(key);
				return value === null ? undefined : value;
			} catch (error) {
				this.logger.warn(
					`Cache read failed for ${key}: ${error instanceof Error ? error.message : error}`
				);
				return undefined;
			}
		}

		const entry = this.memory.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) {
			this.memory.delete(key);
			return undefined;
		}
		return entry.value as T;
	}

	private async write(
		key: string,
		value: unknown,
		ttlSeconds: number
	): Promise<void> {
		if (this.redis) {
			await this.redis.set(key, value, { ex: ttlSeconds }).catch((error: Error) => {
				this.logger.warn(`Cache write failed for ${key}: ${error.message}`);
			});
			return;
		}

		this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
	}
}
