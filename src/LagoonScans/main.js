import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const LagoonScans = new MangaThemesiaExtension({
    name: "Lagoon Scans",
    baseUrl: "https://lagoonscans.com",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
