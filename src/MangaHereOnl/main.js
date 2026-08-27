import { ContentRating } from "@paperback/types";
import { MangaHubExtension } from "../utils/mangahub/template";
export const MangaHereOnl = new MangaHubExtension({
    name: "MangaHere.onl",
    baseUrl: "https://mangahere.onl",
    mangaSource: "mh01",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
