import { JobAlert } from "@/models/job-alerts/entities/job-alert.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class JobAlertRepository extends Repository<JobAlert> {
	constructor(private dataSource: DataSource) {
		super(JobAlert, dataSource.createEntityManager());
	}
}
