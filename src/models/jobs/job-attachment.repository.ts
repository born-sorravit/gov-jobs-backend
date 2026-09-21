import { JobAttachment } from "@/models/jobs/entities/job-attachment.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class JobAttachmentRepository extends Repository<JobAttachment> {
	constructor(private dataSource: DataSource) {
		super(JobAttachment, dataSource.createEntityManager());
	}
}
