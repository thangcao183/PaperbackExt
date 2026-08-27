import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";
class FrierenOnlineExtension extends MadaraExtension {
    // Upstream mangaDetailsParse: this site uses a fully custom details layout
    // (.about / .cover_managa / .synopsis / h5+h4 pairs / .tags a[rel=tag])
    // that none of the standard Madara detail selectors match.
    async getMangaDetails(mangaId) {
        const url = new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubString)
            .addPath(mangaId)
            .build();
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const title = $(".about h1").first().text().trim();
        const image = this.imageFromElement($(".cover_managa img").first());
        const description = $(".synopsis p").first().text().trim();
        const author = $("h5:contains(Author) + h4").first().text().trim();
        const artist = $("h5:contains(Artist) + h4").first().text().trim();
        const genres = [];
        $(".tags a[rel=tag]").each((_, el) => {
            const g = $(el).text().trim();
            if (g)
                genres.push(g);
        });
        const statusText = $("h5:contains(Status) + h4").first().text().trim();
        let status;
        switch (statusText) {
            case "OnGoing":
                status = "Ongoing";
                break;
            case "Completed":
                status = "Completed";
                break;
            default:
                status = "Unknown";
        }
        const tagGroups = [];
        if (genres.length > 0) {
            tagGroups.push({
                id: "genres",
                title: "Genres",
                tags: genres.map((g) => ({
                    id: g.toLowerCase().replace(/\s+/g, "-"),
                    title: g,
                })),
            });
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles: [],
                thumbnailUrl: image,
                author: author || undefined,
                artist: artist || undefined,
                synopsis: description,
                rating: 0,
                contentRating: this.contentRating,
                status,
                tagGroups,
                shareUrl: url,
            },
        };
    }
    // Upstream chapterListParse: chapters live in `li.m-chapter` and the visible
    // name comes from a nested `.chapter-content > div`, not the anchor text.
    // Upstream provides no date/chapter-number parsing.
    async getChapters(sourceManga) {
        const mangaId = sourceManga.mangaId;
        const mangaUrl = new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubString)
            .addPath(mangaId)
            .build();
        const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
        const chapters = [];
        $("li.m-chapter a:has(.chapter-content)").each((_, element) => {
            const link = $(element);
            const href = link.attr("href") || "";
            if (!href)
                return;
            const chapterId = this.parseChapterId(href, mangaId);
            if (!chapterId)
                return;
            const title = link.find(".chapter-content > div").first().text().trim();
            let chapNum = 0;
            const numMatch = title.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i);
            if (numMatch) {
                chapNum = parseFloat(numMatch[1]);
            }
            else {
                const slugMatch = chapterId.match(/chapter-(\d+(?:[.-]\d+)?)/i);
                if (slugMatch)
                    chapNum = parseFloat(slugMatch[1].replace("-", "."));
            }
            chapters.push({
                chapterId,
                sourceManga,
                title,
                volume: 0,
                chapNum,
                publishDate: new Date(),
                langCode: this.langCode,
            });
        });
        return chapters;
    }
}
export const FrierenOnline = new FrierenOnlineExtension({
    name: "Frieren Online",
    baseUrl: "https://www.frieren.online",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
    supportsLatest: false,
});
