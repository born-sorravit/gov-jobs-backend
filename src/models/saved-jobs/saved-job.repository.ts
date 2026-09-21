import { SavedJob } from "@/models/saved-jobs/entities/saved-job.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class SavedJobRepository extends Repository<SavedJob> {
	constructor(private dataSource: DataSource) {
		super(SavedJob, dataSource.createEntityManager());
	}
}
