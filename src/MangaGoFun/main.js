import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const MangaGoFun = new MadaraExtension({
    name: "MangaGo.fun",
    baseUrl: "https://www.mangago.fun",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
