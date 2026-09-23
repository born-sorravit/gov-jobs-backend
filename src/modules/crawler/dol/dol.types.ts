/**
 * One card on a DOL news listing, exactly as the page presents it.
 *
 * DOL publishes no API — this is what `DolParser` recovers from the HTML, kept as a named
 * shape so the parser's output can be asserted against the captured fixture without a
 * crawler, a network call or a database.
 */
export interface DolListingEntry {
	/** The numeric id in `.../news-1789697174/`, unique within DOL. */
	externalId: string;
	title: string;
	/** The announcement's own page, and the `sourceUrl` a user follows to verify it. */
	url: string;
	/** The site's own category chip, e.g. `การสอบ`. Kept for provenance, not for filtering. */
	category: string | null;
	/** `YYYY-MM-DD`, converted from the Thai Buddhist-era date on the card. */
	publishedOn: string | null;
}

/** What the announcement's own page adds to its listing card. */
export interface DolAnnouncementDetail {
	/** Every PDF the page links, in document order. Usually one; occasionally several. */
	pdfUrls: string[];
	/** The announcement body, whitespace-normalised. Null when the page is only a PDF link. */
	body: string | null;
}
