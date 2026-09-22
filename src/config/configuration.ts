import * as fs from "node:fs";
import * as dotenv from "dotenv";

/**
 * Picks the env file from NODE_ENV, mirroring the deployment layout:
 *   development -> .env.development.local
 *   anything else (local, staging, production) -> .env / real process env
 * On Render/Vercel the platform injects the variables directly, so no file exists.
 */
export const getEnvFilePath = (): string | undefined =>
	process.env.NODE_ENV === "development" ? ".env.development.local" : ".env";

export const loadEnv = (): void => {
	const envPath = getEnvFilePath();
	if (!envPath) return;

	if (fs.existsSync(envPath)) {
		dotenv.config({ path: envPath });
		return;
	}

	/**
	 * The file this NODE_ENV selects is missing.
	 *
	 * On Render and Vercel that is normal — the platform injects the variables directly and
	 * there is no file to read. Locally it means every variable is about to be empty, and the
	 * first symptom is something unhelpful and far away, like passport reporting
	 * "JwtStrategy requires a secret or key". Saying so here is much cheaper to debug.
	 */
	if (process.env.NODE_ENV !== "production" && !process.env.JWT_SECRET) {
		// biome-ignore lint/suspicious/noConsole: runs before Nest boots, so there is no Logger yet
		console.warn(
			`[config] ${envPath} not found and no variables are set in the environment.\n` +
				`         NODE_ENV=${process.env.NODE_ENV ?? "(unset)"} selects that file; ` +
				`"npm run start:local" reads .env instead.`
		);
	}
};

/**
 * Refuses to start on a configuration that cannot work.
 *
 * `ConfigService.getOrThrow` does not help here: the keys all exist, they are just empty
 * strings, so it returns "" happily and the failure surfaces much later in whichever library
 * first tries to use one.
 */
export const assertUsableConfiguration = (config: Configuration): void => {
	const missing: string[] = [];

	if (!config.database.url) missing.push("DATABASE_URL");
	if (!config.security.jwt.secret) missing.push("JWT_SECRET");
	if (config.mail.provider === "resend" && !config.mail.apiKey)
		missing.push("RESEND_API_KEY");

	if (missing.length === 0) return;

	throw new Error(
		`Missing required configuration: ${missing.join(", ")}.\n` +
			`Expected them in ${getEnvFilePath() ?? "the environment"} ` +
			`(NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}). See .env.example.`
	);
};

const toInt = (value: string | undefined, fallback: number): number => {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isNaN(parsed) ? fallback : parsed;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
	if (value === undefined || value === "") return fallback;
	return value === "true" || value === "1";
};

export interface AppConfig {
	env: string;
	port: number;
	apiPrefix: string;
	corsOrigins: string[];
	timezone: string;
	publicWebUrl: string;
}

export interface DatabaseConfig {
	url: string;
	synchronize: boolean;
	logging: boolean;
	ssl: { rejectUnauthorized: boolean } | undefined;
}

/**
 * Cache only. BullMQ does **not** run on this — it uses the PostgreSQL backend (see
 * `QueueConfig`), because one idle BullMQ worker issues ~605k Redis commands a month at
 * default settings, against an Upstash free allowance of 500k.
 *
 * Upstash's REST API is a good fit for caching: no TCP socket to hold, works from any
 * runtime, and cache traffic is low enough to stay inside the free tier.
 */
export interface CacheConfig {
	provider: "upstash" | "memory";
	restUrl: string | undefined;
	restToken: string | undefined;
	prefix: string;
	ttlSeconds: number;
}

export interface QueueConfig {
	/**
	 * BullMQ's backend. `postgres` reuses the application database over LISTEN/NOTIFY, so
	 * there is no separate broker to pay for or operate. Requires PostgreSQL >= 13 and a
	 * **session**-mode connection: LISTEN/NOTIFY does not survive transaction pooling.
	 */
	backend: "postgres";
	/** BullMQ keeps its own tables here, clear of the application schema. */
	schema: string;
	prefix: string;
}

export interface SecurityConfig {
	jwt: {
		secret: string;
		/** Access-token lifetime, as a jsonwebtoken duration string (e.g. "15m"). */
		expiresIn: string;
	};
	/**
	 * Refresh tokens are opaque random strings, not JWTs: only their SHA-256 hash is stored,
	 * so a database leak grants no sessions, revocation is a row update rather than a
	 * blocklist, and there is no second signing secret to rotate. `refreshTtlDays` is a
	 * number of days — deliberately not fed to `expiresIn`, which reads a bare number as
	 * *seconds* and would have made a 30-day token live 30 seconds.
	 */
	refreshTtlDays: number;
	bcryptRounds: number;
	throttle: { ttlSeconds: number; limit: number };
	internalApiKey: string;
}

export interface CrawlerConfig {
	ocsc: {
		apiBaseUrl: string;
		portalBaseUrl: string;
		crawlIntervalMinutes: number;
		timeoutMs: number;
		userAgent: string;
	};
	schedulerEnabled: boolean;
}

export interface MailConfig {
	provider: "resend" | "console";
	apiKey: string | undefined;
	from: string;
	replyTo: string | undefined;
}

export interface Configuration {
	app: AppConfig;
	database: DatabaseConfig;
	cache: CacheConfig;
	queue: QueueConfig;
	security: SecurityConfig;
	crawler: CrawlerConfig;
	mail: MailConfig;
}

export default (): Configuration => ({
	app: {
		env: process.env.NODE_ENV ?? "local",
		port: toInt(process.env.PORT, 3001),
		apiPrefix: process.env.API_PREFIX ?? "api",
		corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
		timezone: process.env.APP_TIMEZONE ?? "Asia/Bangkok",
		publicWebUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:3000",
	},
	database: {
		url: process.env.DATABASE_URL ?? "",
		synchronize: false,
		logging: toBool(process.env.DB_LOGGING, false),
		// Supabase (and every managed Postgres we target) terminates TLS with a
		// certificate chain Node does not ship, so verification is opt-in.
		ssl: toBool(process.env.DB_SSL, true)
			? { rejectUnauthorized: false }
			: undefined,
	},
	cache: {
		// Both halves are required: a URL without a token would resolve to "upstash" and
		// then fail on every call. Missing either -> an in-process Map, so local
		// development and tests never depend on a network service.
		provider:
			process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
				? "upstash"
				: "memory",
		restUrl: process.env.UPSTASH_REDIS_REST_URL,
		restToken: process.env.UPSTASH_REDIS_REST_TOKEN,
		prefix: process.env.CACHE_PREFIX ?? "gov-jobs",
		ttlSeconds: toInt(process.env.CACHE_TTL_SECONDS, 300),
	},
	queue: {
		backend: "postgres",
		schema: process.env.QUEUE_SCHEMA ?? "bullmq",
		prefix: process.env.QUEUE_PREFIX ?? "gov-jobs",
	},
	security: {
		jwt: {
			secret: process.env.JWT_SECRET ?? "",
			expiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
		},
		refreshTtlDays: toInt(process.env.REFRESH_TTL_DAYS, 30),
		bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 10),
		throttle: {
			ttlSeconds: toInt(process.env.THROTTLE_TTL_SECONDS, 60),
			limit: toInt(process.env.THROTTLE_LIMIT, 120),
		},
		internalApiKey: process.env.INTERNAL_API_KEY ?? "",
	},
	crawler: {
		ocsc: {
			apiBaseUrl:
				process.env.OCSC_API_BASE_URL ?? "https://jobapp.ocsc.go.th/jobapi",
			portalBaseUrl:
				process.env.OCSC_PORTAL_BASE_URL ?? "https://job.ocsc.go.th/portal",
			crawlIntervalMinutes: toInt(process.env.OCSC_CRAWL_INTERVAL_MINUTES, 60),
			timeoutMs: toInt(process.env.OCSC_TIMEOUT_MS, 30_000),
			userAgent:
				process.env.OCSC_USER_AGENT ??
				"gov-jobs-alert/1.0 (+https://github.com/gov-jobs; public job announcement aggregator)",
		},
		// Render's free web service spins down when idle, so the in-process cron cannot be
		// trusted there. Deployments leave this off and drive crawls through the
		// authenticated internal endpoint from an external scheduler instead.
		schedulerEnabled: toBool(process.env.CRAWLER_SCHEDULER_ENABLED, false),
	},
	mail: {
		provider: (process.env.MAIL_PROVIDER as MailConfig["provider"]) ?? "console",
		apiKey: process.env.RESEND_API_KEY,
		from: process.env.MAIL_FROM ?? "Gov Jobs Alert <onboarding@resend.dev>",
		replyTo: process.env.MAIL_REPLY_TO,
	},
});
