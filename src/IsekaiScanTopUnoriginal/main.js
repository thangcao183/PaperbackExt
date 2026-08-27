import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
class IsekaiScanTopUnoriginalExtension extends MadaraExtension {
    // Upstream `chapterListParse`: when the chapter <li>s aren't inlined, this
    // source loads them from its own AJAX endpoint
    // `GET $baseUrl/ajax-list-chapter?mangaID=$mangaId` (using the `data-id` from
    // `div[id^=manga-chapters-holder]`), rather than the standard Madara
    // admin-ajax / `/ajax/chapters` endpoints.
    async getChapters(sourceManga) {
        const mangaId = sourceManga.mangaId;
        const mangaUrl = `${this.baseUrl}/${this.mangaSubString}/${mangaId}`;
        let $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
        let chapterElements = $(this.chapterListSelector);
        if (chapterElements.length === 0) {
            const dataId = $("div[id^=manga-chapters-holder]").first().attr("data-id");
            if (dataId) {
                const xhr = await this.fetchCheerio({
                    url: `${this.baseUrl}/ajax-list-chapter?mangaID=${dataId}`,
                    method: "GET",
                    headers: {
                        "x-requested-with": "XMLHttpRequest",
                        referer: `${this.baseUrl}/`,
                    },
                });
                $ = xhr;
                chapterElements = xhr(this.chapterListSelector);
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
            const dateText = el.find("span.chapter-release-date").text().trim();
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
    // Upstream `pageListParse`: the page image URLs are stored as a comma
    // separated list inside `p#arraydata`, rather than as <img> elements.
    async getChapterDetails(chapter) {
        // Upstream keeps the default Madara `chapterUrlSuffix = "?style=list"`.
        const url = `${this.baseUrl}/${this.mangaSubString}/${chapter.sourceManga.mangaId}/${chapter.chapterId}?style=list`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const pages = $("p#arraydata")
            .text()
            .split(",")
            .map((u) => u.trim())
            .filter((u) => u.length > 0);
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
}
export const IsekaiScanTopUnoriginal = new IsekaiScanTopUnoriginalExtension({
    name: "IsekaiScan.top (unoriginal)",
    baseUrl: "https://isekaiscan.top",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
