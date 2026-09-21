import { BaseEntity } from "@/models/base.entity";
import { Job } from "@/models/jobs/entities/job.entity";
import { User } from "@/models/users/entities/user.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";

@Entity("saved_job")
@Unique("uq_saved_job_user_job", ["userId", "jobId"])
export class SavedJob extends BaseEntity {
	@Index("idx_saved_job_user_id")
	@Column({ name: "user_id", type: "uuid" })
	userId: string;

	@ManyToOne(() => User, { onDelete: "CASCADE" })
	@JoinColumn({ name: "user_id" })
	user: User;

	@Column({ name: "job_id", type: "uuid" })
	jobId: string;

	@ManyToOne(() => Job, { onDelete: "CASCADE" })
	@JoinColumn({ name: "job_id" })
	job: Job;
}
