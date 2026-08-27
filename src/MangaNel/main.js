import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";
export const MangaNel = new MangaHubExtension({
    name: "MangaNel",
    baseUrl: "https://manganel.me",
    mangaSource: "mn05",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
