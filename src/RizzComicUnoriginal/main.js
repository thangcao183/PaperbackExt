import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const RizzComicUnoriginal = new MangaThemesiaExtension({
    name: "Rizz Comic (unoriginal)",
    baseUrl: "https://rizzcomic.com",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
