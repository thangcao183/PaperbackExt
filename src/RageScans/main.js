import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const RageScans = new MangaThemesiaExtension({
    name: "Rage Scans",
    baseUrl: "https://ragescans.com",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
