import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";
export const MangaOnlineFun = new MangaHubExtension({
    name: "MangaOnline.fun",
    baseUrl: "https://mangaonline.fun",
    mangaSource: "m02",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
