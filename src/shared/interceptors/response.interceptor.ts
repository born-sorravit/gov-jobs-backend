import { ApiResponse } from "@/shared/interfaces/response.interface";
import { PaginatedResponse } from "@/shared/utils/pagination.util";
import {
	CallHandler,
	ExecutionContext,
	Injectable,
	NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

/**
 * A handler's return value when it wants to set the envelope's `message` itself. Handlers
 * that just return a payload are the common case and need none of this.
 */
export class MessagedResponse<T> {
	constructor(
		readonly data: T,
		readonly message: string
	) {}
}

/**
 * Envelopes every handler return value as `{ status, message, data }`, plus `meta` when the
 * handler returns a `PaginatedResponse`.
 *
 * Both branches are chosen by `instanceof`, never by inspecting the payload's keys. Duck
 * typing here would let a payload that happens to have `status` or `meta` — and jobs do
 * carry a `status` of OPEN/CLOSED/UPCOMING — overwrite the envelope's own fields.
 */
@Injectable()
export class ResponseFormatInterceptor<T> implements NestInterceptor {
	intercept(
		_context: ExecutionContext,
		next: CallHandler
	): Observable<ApiResponse<unknown>> {
		return next.handle().pipe(
			map((result: unknown) => {
				if (result instanceof PaginatedResponse) {
					return {
						status: "success" as const,
						message: null,
						data: result.data as T,
						meta: result.meta,
					};
				}

				if (result instanceof MessagedResponse) {
					return {
						status: "success" as const,
						statusCode: 200,
						message: result.message,
						data: result.data as T,
					};
				}

				return {
					status: "success" as const,
					statusCode: 200,
					message: null,
					data: result as T,
				};
			})
		);
	}
}
