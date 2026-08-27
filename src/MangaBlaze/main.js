import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
// MangaBlaze runs the bespoke "UTOON-ZAX" theme rather than a stock Madara
// layout (keiyoushi PR #16971). Browse, search and detail markup all differ
// from the framework defaults, so discover + search are overridden here while
// detail selectors and the chapter list (standard `wp-manga-chapter` markup
// served by `ajax/chapters`) are handled by the base class via config.
class MangaBlazeExtension extends MadaraExtension {
    async getDiscoverSectionItems(section, metadata) {
        if (section.id !== "popular_section" &&
            section.id !== "latest_section") {
            return { items: [] };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.collectedIds ?? [];
        const orderby = section.id === "popular_section" ? "popular" : "new";
        const itemType = section.id === "popular_section"
            ? "featuredCarouselItem"
            : "simpleCarouselItem";
        const url = `${this.baseUrl}/${this.mangaSubString}/` +
            (page > 1 ? `page/${page}/` : "") +
            `?orderby=${orderby}`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        $("a.acard").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            const title = el.find(".ac-t").first().text().trim() ||
                el.find(".ac-img img").first().attr("alt") ||
                "";
            const image = this.imageFromElement(el.find(".ac-img img").first());
            const mangaId = this.parseMangaId(href);
            if (title && mangaId && image && !collectedIds.includes(mangaId)) {
                collectedIds.push(mangaId);
                items.push({
                    type: itemType,
                    mangaId,
                    imageUrl: image,
                    title,
                    metadata: undefined,
                });
            }
        });
        const hasNextPage = $(".pager span.on + a").length > 0;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
        };
    }
    async getSearchResults(query, metadata, _sortingOption) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.searchCollectedIds ?? [];
        const titleQuery = (query.title || "").trim();
        const url = `${this.baseUrl}/` +
            (page > 1 ? `page/${page}/` : "") +
            `?s=${encodeURIComponent(titleQuery)}&post_type=wp-manga`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $("a.acard").each((_, element) => {
            const el = $(element);
            const href = el.attr("href") || "";
            const title = el.find(".ac-t").first().text().trim() ||
                el.find(".ac-img img").first().attr("alt") ||
                "";
            const image = this.imageFromElement(el.find(".ac-img img").first());
            const mangaId = this.parseMangaId(href);
            if (title && mangaId && image && !collectedIds.includes(mangaId)) {
                collectedIds.push(mangaId);
                results.push({
                    mangaId,
                    imageUrl: image,
                    title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            }
        });
        const hasNextPage = $(".pager span.on + a").length > 0;
        const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedPageLimit
                ? { page: page + 1, searchCollectedIds: collectedIds }
                : undefined,
        };
    }
}
export const MangaBlaze = new MangaBlazeExtension({
    name: "MangaBlaze",
    baseUrl: "https://mangablaze.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    // UTOON-ZAX detail-page selectors.
    mangaDetailsTitleSelector: "h1.htitle",
    mangaDetailsThumbnailSelector: ".poster img",
    mangaDetailsDescriptionSelector: ".syn",
    mangaDetailsStatusSelector: ".hinfo .hi.ok",
    // The detail page embeds no chapters; they are loaded from `ajax/chapters`
    // as standard Madara `wp-manga-chapter` markup. Premium chapters carry the
    // `premium-block` class and are excluded.
    chapterListSelector: "li.wp-manga-chapter:not(.premium-block)",
});
