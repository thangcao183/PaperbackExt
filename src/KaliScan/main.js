import { ContentRating } from "@paperback/types";
import { MadThemeExtension } from "../utils/madtheme/template";
export const KaliScan = new MadThemeExtension({
    name: "KaliScan",
    baseUrl: "https://kaliscan.com",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    useLegacyApi: true,
});
