import { ErrorResponse } from "@/shared/interfaces/response.interface";
import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(GlobalExceptionFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const response = host.switchToHttp().getResponse<Response>();

		let status = HttpStatus.INTERNAL_SERVER_ERROR;
		let message = "Internal server error";

		if (exception instanceof HttpException) {
			status = exception.getStatus();
			const body = exception.getResponse();

			if (typeof body === "string") {
				message = body;
			} else if (typeof body === "object" && body !== null) {
				const objMessage = (body as Record<string, unknown>).message;
				if (Array.isArray(objMessage)) {
					message = objMessage.join(", ");
				} else if (typeof objMessage === "string") {
					message = objMessage;
				}
			}
		} else {
			// Never leak an internal stack to the client, but do not lose it either.
			this.logger.error(
				exception instanceof Error ? exception.message : "Unhandled exception",
				exception instanceof Error ? exception.stack : undefined
			);
		}

		const errorResponse: ErrorResponse = {
			status: "error",
			statusCode: status,
			message,
		};
		response.status(status).json(errorResponse);
	}
}
