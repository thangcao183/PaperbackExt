import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";
export const OneMangaInfo = new MangaHubExtension({
    name: "OneManga.info",
    baseUrl: "https://onemanga.info",
    mangaSource: "mh01",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
