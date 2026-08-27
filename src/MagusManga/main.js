import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";
export const MagusManga = new IkenExtension({
    name: "Magus Manga",
    baseUrl: "https://magustoon.org",
    apiUrl: "https://api.magustoon.org",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
