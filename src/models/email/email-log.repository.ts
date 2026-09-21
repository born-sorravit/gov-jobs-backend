import { EmailLog } from "@/models/email/entities/email-log.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class EmailLogRepository extends Repository<EmailLog> {
	constructor(private dataSource: DataSource) {
		super(EmailLog, dataSource.createEntityManager());
	}
}
