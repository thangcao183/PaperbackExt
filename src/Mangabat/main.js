import { ContentRating } from "@paperback/types";
import { MangaBoxExtension } from "../utils/mangabox/template";
export const Mangabat = new MangaBoxExtension({
    name: "Mangabat",
    baseUrl: "https://www.mangabats.com",
    mirrors: ["https://www.mangabats.com"],
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
