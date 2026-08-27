import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";
class TopManhuaExtension extends MadaraExtension {
    // Upstream override: `fetchChapterList` paginates the AJAX chapter endpoint,
    // requesting `POST {mangaUrl}ajax/chapters/?t=<page>` for page = 1, 2, 3, …
    // and accumulating results until a page returns no chapters.
    async getChapters(sourceManga) {
        const mangaId = sourceManga.mangaId;
        const mangaUrl = new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubString)
            .addPath(mangaId)
            .build();
        const chapters = [];
        let page = 1;
        while (true) {
            const $ = await this.fetchCheerio({
                url: `${mangaUrl}/ajax/chapters/?t=${page}`,
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    referer: `${mangaUrl}/`,
                    "x-requested-with": "XMLHttpRequest",
                },
            });
            page += 1;
            const elements = $(this.chapterListSelector);
            if (elements.length === 0) {
                break;
            }
            elements.each((_, element) => {
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
        }
        return chapters;
    }
}
export const TopManhua = new TopManhuaExtension({
    name: "Top Manhua",
    baseUrl: "https://mangatop.org",
    mangaSubString: "manhua",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    filterNonMangaItems: false,
});
