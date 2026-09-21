import { Job } from "@/models/jobs/entities/job.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class JobRepository extends Repository<Job> {
	constructor(private dataSource: DataSource) {
		super(Job, dataSource.createEntityManager());
	}
}
