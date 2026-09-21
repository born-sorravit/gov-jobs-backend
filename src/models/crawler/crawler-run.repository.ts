import { CrawlerRun } from "@/models/crawler/entities/crawler-run.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class CrawlerRunRepository extends Repository<CrawlerRun> {
	constructor(private dataSource: DataSource) {
		super(CrawlerRun, dataSource.createEntityManager());
	}
}
