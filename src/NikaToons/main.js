import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const NikaToons = new MangaThemesiaExtension({
    name: "Nika Toons",
    baseUrl: "https://nikatoons.com",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
