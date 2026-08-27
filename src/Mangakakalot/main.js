import { ContentRating } from "@paperback/types";
import { MangaBoxExtension } from "../utils/mangabox/template";
export const Mangakakalot = new MangaBoxExtension({
    name: "Mangakakalot",
    baseUrl: "https://www.mangakakalot.gg",
    mirrors: ["https://www.mangakakalot.gg", "https://www.mangakakalove.com"],
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    // Listings occasionally expose opaque id slugs (e.g. `mw123456`); recompute
    // the canonical slug from the title in that case.
    legacySlugRegex: /^[a-z]{2}\d+$/,
});
