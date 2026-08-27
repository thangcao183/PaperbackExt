import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const SkyManga = new MangaThemesiaExtension({
    name: "Sky Manga",
    baseUrl: "https://skymanga.work",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
