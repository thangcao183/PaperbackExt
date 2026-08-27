import { ContentRating } from "@paperback/types";
import { IkenExtension } from "../utils/iken/template";
export const Renascans = new IkenExtension({
    name: "Renascans",
    baseUrl: "https://renascans.net",
    apiUrl: "https://api.renascans.net",
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
