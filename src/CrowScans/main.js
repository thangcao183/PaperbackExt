import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const CrowScans = new MangaThemesiaExtension({
    name: "Crow Scans",
    baseUrl: "https://crowscans.xyz",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
