import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
	IsEmail,
	IsIn,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from "class-validator";

const normaliseEmail = ({ value }: { value: unknown }): unknown =>
	typeof value === "string" ? value.trim().toLowerCase() : value;

export class RegisterDto {
	@ApiProperty({ example: "somchai@example.com" })
	@IsEmail()
	@MaxLength(255)
	// Stored lowercase so "Somchai@…" and "somchai@…" cannot become two accounts.
	@Transform(normaliseEmail)
	email: string;

	@ApiProperty({ minLength: 8, maxLength: 128 })
	@IsString()
	@MinLength(8)
	@MaxLength(128)
	password: string;

	@ApiProperty({ example: "สมชาย ใจดี" })
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	@Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
	name: string;

	@ApiPropertyOptional({ enum: ["th", "en"], default: "th" })
	@IsOptional()
	@IsIn(["th", "en"])
	locale?: string;
}

export class LoginDto {
	@ApiProperty()
	@IsEmail()
	@Transform(normaliseEmail)
	email: string;

	@ApiProperty()
	@IsString()
	@MinLength(1)
	password: string;
}

export class RefreshDto {
	@ApiProperty({
		description: "The opaque refresh token returned by login or refresh",
	})
	@IsString()
	@MinLength(1)
	refreshToken: string;
}

export class AuthUserResponse {
	@ApiProperty() id: string;
	@ApiProperty() email: string;
	@ApiProperty() name: string;
	@ApiProperty() role: string;
	@ApiProperty() isVerified: boolean;
	@ApiProperty() locale: string;
}

export class AuthSessionResponse {
	@ApiProperty() accessToken: string;
	@ApiProperty({ description: "Opaque; store it somewhere JavaScript cannot read." })
	refreshToken: string;
	@ApiProperty({ description: "Access-token lifetime in seconds." })
	expiresIn: number;
	@ApiProperty({ type: AuthUserResponse }) user: AuthUserResponse;
}
