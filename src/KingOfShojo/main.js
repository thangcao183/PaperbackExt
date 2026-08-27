import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const KingOfShojo = new MangaThemesiaExtension({
    name: "King of Shojo",
    baseUrl: "https://kingofshojo.com",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
