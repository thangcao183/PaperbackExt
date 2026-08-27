import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
class MangaHeExtension extends MadaraExtension {
    // Faithful port of upstream pageListParse: skip the first page when it is
    // a self-promotion image whose URL ends with `/1-000001.jpg`.
    async getChapterDetails(chapter) {
        const details = await super.getChapterDetails(chapter);
        const basePages = "pages" in details ? details.pages : [];
        const pages = basePages.filter((page, idx) => !(idx === 0 && page.endsWith("/1-000001.jpg")));
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
}
export const MangaHe = new MangaHeExtension({
    name: "MangaHe",
    baseUrl: "https://mangahe.com",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
