import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const LilyManga = new MadaraExtension({
    name: "Lily Manga",
    baseUrl: "https://lilymanga.net",
    mangaSubString: "gl",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
