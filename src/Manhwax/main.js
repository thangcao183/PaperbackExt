import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const Manhwax = new MangaThemesiaExtension({
    name: "Manhwax",
    baseUrl: "https://manhwax.top",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
