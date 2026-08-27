import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";
export const HijalaScans = new IkenExtension({
    name: "Hijala Scans",
    baseUrl: "https://en-hijala.com",
    apiUrl: "https://api.en-hijala.com",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
