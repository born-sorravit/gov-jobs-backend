/**
 * One row on the MDES "สมัครงาน" listing.
 *
 * MDES publishes no API and shows no date on the listing itself, so this carries only what
 * the category page actually has — the date and the attachment come from the announcement
 * page, one fetch per entry the filter keeps.
 */
export interface MdesListingEntry {
	/** The numeric prefix of the detail slug, which is stable while the slug is not. */
	externalId: string;
	title: string;
	url: string;
}

/** What the announcement page adds. */
export interface MdesAnnouncementDetail {
	/**
	 * Attachment URLs. MDES serves them from `content/download-detail/{id}` with no file
	 * extension — the PDF is behind a content-type header, not a `.pdf` suffix, so these
	 * cannot be found by matching on one.
	 */
	attachmentUrls: string[];
	/** `YYYY-MM-DD`, converted from the `dd/mm/BE` stamp on the page. */
	publishedOn: string | null;
	body: string | null;
}
