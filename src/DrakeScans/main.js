import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const DrakeScans = new MangaThemesiaExtension({
    name: "Drake Scans",
    baseUrl: "https://drakecomic.org",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
