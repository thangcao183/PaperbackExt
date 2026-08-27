import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";
class BattleIn5SecondsAfterMeetingExtension extends MadaraExtension {
    // Upstream `chapterListParse` override: chapters live in `.main-chapter`
    // elements whose visible title comes from `.chapter-content`, while the
    // standard `li.wp-manga-chapter` list is parsed only to harvest the matching
    // upload dates by exact name match against the unstripped chapter content.
    async getChapters(sourceManga) {
        const mangaId = sourceManga.mangaId;
        const mangaUrl = new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubString)
            .addPath(mangaId)
            .build();
        const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });
        // Build the date lookup from the standard Madara chapter list. The key is
        // the full anchor text (the unstripped chapter content), matching upstream
        // `recentChapters.find { it.name == chapterContent }`.
        const recentDates = new Map();
        $(this.chapterListSelector).each((_, element) => {
            const el = $(element);
            const name = el.find("a").first().text().trim();
            if (!name)
                return;
            const dateText = el.find("span.chapter-release-date").text().trim();
            if (!recentDates.has(name)) {
                recentDates.set(name, this.parseDate(dateText));
            }
        });
        const namePrefix = "Battle in 5 Seconds After Meeting, ";
        const chapters = [];
        $(".main-chapter").each((_, element) => {
            const el = $(element);
            const href = el.find("a").first().attr("href") || "";
            if (!href)
                return;
            const chapterContent = el.find(".chapter-content").first().text().trim();
            const chapterId = this.parseChapterId(href, mangaId);
            if (!chapterId)
                return;
            const title = chapterContent.startsWith(namePrefix)
                ? chapterContent.slice(namePrefix.length)
                : chapterContent;
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
            const publishDate = recentDates.get(chapterContent);
            chapters.push({
                chapterId,
                sourceManga,
                title,
                volume: 0,
                chapNum,
                publishDate,
                langCode: this.langCode,
            });
        });
        return chapters;
    }
}
export const BattleIn5SecondsAfterMeeting = new BattleIn5SecondsAfterMeetingExtension({
    name: "Battle In 5 Seconds After Meeting",
    baseUrl: "https://www.deatte5.com",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    supportsLatest: false,
    mangaDetailsStatusSelector: "h5:contains(Status) + h4",
    mangaDetailsDescriptionSelector: ".synopsis p",
    mangaDetailsThumbnailSelector: ".cover_managa img",
    mangaDetailsTitleSelector: "h1",
    mangaDetailsAuthorSelector: "h5:contains(Author) + h4 a",
    mangaDetailsArtistSelector: "h5:contains(Artist) + h4 a",
});
