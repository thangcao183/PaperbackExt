import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";
export const MangaFoxFun = new MangaHubExtension({
    name: "MangaFox.fun",
    baseUrl: "https://mangafox.fun",
    mangaSource: "mf01",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
