import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const GalaxyManga = new MangaThemesiaExtension({
    name: "Galaxy Manga",
    baseUrl: "https://galaxymanga.io",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
