import { ReferenceItem } from "@/models/reference/entities/reference-item.entity";
import { Injectable } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";

@Injectable()
export class ReferenceItemRepository extends Repository<ReferenceItem> {
	constructor(private dataSource: DataSource) {
		super(ReferenceItem, dataSource.createEntityManager());
	}
}
