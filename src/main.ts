import { AppModule } from "@/app.module";
import { loadEnv } from "@/config/configuration";
import { GlobalExceptionFilter } from "@/shared/filters/global.filter";
import { ResponseFormatInterceptor } from "@/shared/interceptors/response.interceptor";
import { Logger, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";

loadEnv();

async function bootstrap(): Promise<void> {
	const logger = new Logger("Bootstrap");
	const app = await NestFactory.create(AppModule, { bufferLogs: false });
	const config = app.get(ConfigService);

	const port = config.get<number>("app.port", 3001);
	const apiPrefix = config.get<string>("app.apiPrefix", "api");
	const corsOrigins = config.get<string[]>("app.corsOrigins", []);
	const env = config.get<string>("app.env", "local");

	app.setGlobalPrefix(apiPrefix, { exclude: ["healthcheck"] });
	app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

	app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
	app.enableCors({
		origin: corsOrigins.length > 0 ? corsOrigins : false,
		credentials: true,
		methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
	});

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			forbidNonWhitelisted: false,
			transformOptions: { enableImplicitConversion: false },
		})
	);
	app.useGlobalInterceptors(new ResponseFormatInterceptor());
	app.useGlobalFilters(new GlobalExceptionFilter());

	if (env !== "production") {
		const swaggerConfig = new DocumentBuilder()
			.setTitle("Gov Jobs Alert API")
			.setDescription(
				"Public Thai government job announcements, search and email alerts"
			)
			.setVersion("1.0")
			.addBearerAuth()
			.build();
		SwaggerModule.setup(
			"api-docs",
			app,
			SwaggerModule.createDocument(app, swaggerConfig)
		);
		logger.log(`Swagger UI at http://localhost:${port}/api-docs`);
	}

	await app.listen(port, "0.0.0.0");
	logger.log(`API listening on port ${port} (${env}), prefix /${apiPrefix}/v1`);
}

void bootstrap();
