import { ContentRating } from "@paperback/types";
import { MangAdventureExtension } from "../utils/mangadventure/template";
export const AssortedScans = new MangAdventureExtension({
    name: "Assorted Scans",
    baseUrl: "https://assortedscans.com",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
