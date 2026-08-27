import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";
export const VanillaScans = new IkenExtension({
    name: "Vanilla Scans",
    baseUrl: "https://vanillascans.org",
    apiUrl: "https://api.vanillascans.org",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
