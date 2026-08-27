import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const CucumberManga = new MadaraExtension({
    name: "Cucumber Manga",
    baseUrl: "https://cucumbermanga.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
});
