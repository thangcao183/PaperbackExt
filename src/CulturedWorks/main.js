import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const CulturedWorks = new MangaThemesiaExtension({
    name: "CulturedWorks",
    baseUrl: "https://culturedworks.com",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
