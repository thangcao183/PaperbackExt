import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const Armageddon = new MangaThemesiaExtension({
    name: "Armageddon",
    baseUrl: "https://www.silentquill.net",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
