import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const ComicsLand = new MangaThemesiaExtension({
    name: "Comics Land",
    baseUrl: "https://comicsland.org",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
