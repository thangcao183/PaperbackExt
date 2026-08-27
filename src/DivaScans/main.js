import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";
export const DivaScans = new IkenExtension({
    name: "Diva Scans",
    baseUrl: "https://divatoon.com",
    apiUrl: "https://api.divatoon.com",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
