import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";
class MangaDassExtension extends MadaraExtension {
    // Upstream popularMangaFromElement: title from <h3>, thumbnail from <img>,
    // url from the first <a>. The base template derives both title and href
    // from a single popularMangaUrlSelector, so we re-implement the listing
    // parse to read the title from <h3> instead.
    async getDiscoverSectionItems(section, metadata) {
        const itemType = section.id === "popular_section"
            ? "featuredCarouselItem"
            : section.id === "latest_section"
                ? "simpleCarouselItem"
                : undefined;
        if (!itemType) {
            return { items: [] };
        }
        const orderBy = section.id === "popular_section" ? "trending" : "latest";
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.collectedIds ?? [];
        const builder = new URLBuilder(this.baseUrl).addPath(this.mangaSubString);
        if (page > 1) {
            builder.addPath("page").addPath(page.toString());
        }
        const url = builder.addQuery("m_orderby", orderBy).build();
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const items = [];
        $("div.page-item-detail, .manga__item").each((_, element) => {
            const unit = $(element);
            const title = unit.find("h3").first().text().trim();
            const href = unit.find("a").first().attr("href") || "";
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
        const hasNextPage = $("div.nav-previous, nav.navigation-ajax, a.nextpostslink").length > 0;
        return {
            items,
            metadata: hasNextPage ? { page: page + 1, collectedIds } : undefined,
        };
    }
    // Upstream chapterFromElement reads the upload date from `.chapter-time`
    // (the base template uses `span.chapter-release-date`). The chapter list
    // selector `.row-content-chapter li` and the `?style=list` suffix are set
    // via config; only the date source differs, so we re-implement getChapters.
    async getChapters(sourceManga) {
        const mangaId = sourceManga.mangaId;
        const mangaUrl = new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubString)
            .addPath(mangaId)
            .build();
        let $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
        let chapterElements = $(this.chapterListSelector);
        if (chapterElements.length === 0) {
            try {
                const ajax = await this.fetchCheerio({
                    url: `${mangaUrl}/ajax/chapters`,
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        referer: `${mangaUrl}/`,
                        "x-requested-with": "XMLHttpRequest",
                    },
                });
                if (ajax(this.chapterListSelector).length > 0) {
                    $ = ajax;
                    chapterElements = ajax(this.chapterListSelector);
                }
            }
            catch {
                // ignore, fall through with whatever we have
            }
        }
        const chapters = [];
        chapterElements.each((_, element) => {
            const el = $(element);
            const link = el.find("a").first();
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterTitle = link.text().trim();
            const chapterId = this.parseChapterId(href, mangaId);
            if (!chapterId)
                return;
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
            const dateText = el.find(".chapter-time").first().text().trim();
            const publishDate = this.parseDate(dateText);
            chapters.push({
                chapterId,
                sourceManga,
                title: chapterTitle,
                volume: 0,
                chapNum,
                publishDate,
                langCode: this.langCode,
            });
        });
        return chapters;
    }
}
export const MangaDass = new MangaDassExtension({
    name: "Manga Dass",
    baseUrl: "https://mangadass.com",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    filterNonMangaItems: false,
    useLoadMoreRequest: false,
    // Upstream chapterListSelector = ".row-content-chapter li".
    chapterListSelector: ".row-content-chapter li",
    // Upstream pageListParse selects `.read-content img`.
    pageListSelector: ".read-content img",
});
