import { ContentRating } from "@paperback/types";
import { MangaKExtension } from "../utils/mangak/template";
export const MangaK = new MangaKExtension({
    name: "MangaK",
    baseUrl: "https://mangak.io",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
