import { ContentRating } from "@paperback/types";
import { MonochromeExtension } from "../utils/monochrome/template";
export const MonochromeScans = new MonochromeExtension({
    name: "Monochrome Scans",
    baseUrl: "https://manga.d34d.one",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
