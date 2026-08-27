import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";
export const KaynScans = new IkenExtension({
    name: "Kayn Scans",
    baseUrl: "https://kaynscan.org",
    apiUrl: "https://api.kaynscan.org",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
