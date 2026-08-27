import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const ElfToon = new MangaThemesiaExtension({
    name: "Elf Toon",
    baseUrl: "https://elftoon.com",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
