import { JobAlertMatch } from "@/models/job-alerts/entities/job-alert-match.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class JobAlertMatchRepository extends Repository<JobAlertMatch> {
	constructor(private dataSource: DataSource) {
		super(JobAlertMatch, dataSource.createEntityManager());
	}
}
