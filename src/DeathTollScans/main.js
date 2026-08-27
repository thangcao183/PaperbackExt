import { ContentRating } from "@paperback/types";
import { FoolSlideExtension } from "../utils/foolslide/template";
export const DeathTollScans = new FoolSlideExtension({
    name: "Death Toll Scans",
    baseUrl: "https://reader.deathtollscans.net",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
