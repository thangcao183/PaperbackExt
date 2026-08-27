import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
class MangaGGExtension extends MadaraExtension {
    // ============================== Discover ==============================
    // Upstream overrides popular/latest to use a bespoke `madara_load_more`
    // request (template `content-search`, ordered by week-views / latest-update)
    // and parses items with `searchMangaFromElement` (search-style containers).
    async getDiscoverSectionItems(section, metadata) {
        let itemType;
        let popular;
        switch (section.id) {
            case "popular_section":
                itemType = "featuredCarouselItem";
                popular = true;
                break;
            case "latest_section":
                itemType = "simpleCarouselItem";
                popular = false;
                break;
            default:
                return { items: [] };
        }
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.collectedIds ?? [];
        const $ = await this.fetchCheerio({
            url: `${this.baseUrl}/wp-admin/admin-ajax.php`,
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest",
                referer: `${this.baseUrl}/`,
            },
            body: this.mangaggLoadMoreBody(page, popular),
        });
        const items = [];
        // Upstream popularMangaSelector == searchMangaSelector.
        $("div.c-tabs-item__content, .manga__item").each((_, element) => {
            const unit = $(element);
            const titleLink = unit.find(this.searchMangaUrlSelector).first();
            const title = titleLink.text().trim() || titleLink.attr("title") || "";
            const href = titleLink.attr("href") || "";
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromElement(unit.find("img").first());
            if (title && mangaId && !collectedIds.includes(mangaId)) {
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
        // Empty fragment => no more pages (upstream nextPage: body:not(:has(.no-posts))).
        const hasNextPage = items.length > 0;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
        };
    }
    /** Faithful port of upstream `mangaggLoadMoreRequest` form body. */
    mangaggLoadMoreBody(page, popular) {
        const params = [
            ["action", "madara_load_more"],
            ["page", (page - 1).toString()],
            ["template", "madara-core/content/content-search"],
            ["vars[s]", ""],
            ["vars[orderby]", "meta_value_num"],
            ["vars[paged]", "1"],
            ["vars[template]", "search"],
            ["vars[meta_query][0][relation]", "AND"],
            ["vars[meta_query][relation]", "AND"],
            ["vars[post_type]", "wp-manga"],
            ["vars[post_status]", "publish"],
            [
                "vars[meta_key]",
                popular ? "_wp_manga_week_views_value" : "_latest_update",
            ],
            ["vars[order]", "desc"],
            ["vars[manga_archives_item_layout]", "big_thumbnail"],
        ];
        return params
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join("&");
    }
    // ============================= Chapters ==============================
    // Upstream `fetchChapterList`: use direct chapters if present; otherwise, if
    // a `manga-chapters-holder` exists, paginate POST {mangaUrl}/ajax/chapters/?t=N
    // until an empty page or no `.pagination a[data-page=N+1]` link remains.
    async getChapters(sourceManga) {
        const mangaId = sourceManga.mangaId;
        const mangaUrl = `${this.baseUrl}/${this.mangaSubString}/${mangaId}`;
        const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
        const directChapters = $(this.chapterListSelector);
        const chapters = [];
        if (directChapters.length > 0) {
            directChapters.each((_, element) => {
                const chapter = this.buildChapter($, element, sourceManga);
                if (chapter)
                    chapters.push(chapter);
            });
            return chapters;
        }
        if ($("div[id^=manga-chapters-holder]").length === 0) {
            return [];
        }
        // Paginated AJAX chapter loading.
        const baseChapterUrl = mangaUrl.replace(/\/+$/, "");
        let page = 1;
        // Guard against runaway loops on malformed pagination markup.
        for (;;) {
            const xhr = await this.fetchCheerio({
                url: `${baseChapterUrl}/ajax/chapters/?t=${page}`,
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    referer: `${baseChapterUrl}/`,
                    "x-requested-with": "XMLHttpRequest",
                },
            });
            const elements = xhr(this.chapterListSelector);
            if (elements.length === 0)
                break;
            elements.each((_, element) => {
                const chapter = this.buildChapter(xhr, element, sourceManga);
                if (chapter)
                    chapters.push(chapter);
            });
            if (xhr(`.pagination a[data-page=${page + 1}]`).length === 0)
                break;
            page++;
        }
        return chapters;
    }
    /** Mirror of the template's per-element chapter construction. */
    buildChapter($, element, sourceManga) {
        const el = $(element);
        const link = el.find("a").first();
        const href = link.attr("href") || "";
        if (!href)
            return undefined;
        const chapterTitle = link.text().trim();
        const chapterId = this.parseChapterId(href, sourceManga.mangaId);
        if (!chapterId)
            return undefined;
        let chapNum = 0;
        const numMatch = chapterTitle.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
        if (numMatch) {
            chapNum = parseFloat(numMatch[1]);
        }
        else {
            const slugMatch = chapterId.match(/chapter-(\d+(?:[.-]\d+)?)/i);
            if (slugMatch)
                chapNum = parseFloat(slugMatch[1].replace("-", "."));
        }
        const dateText = el.find("span.chapter-release-date").text().trim();
        const publishDate = this.parseDate(dateText);
        return {
            chapterId,
            sourceManga,
            title: chapterTitle,
            volume: 0,
            chapNum,
            publishDate,
            langCode: this.langCode,
        };
    }
}
export const MangaGG = new MangaGGExtension({
    name: "MangaGG",
    baseUrl: "https://mangagg.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
