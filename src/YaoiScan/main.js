import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const YaoiScan = new MadaraExtension({
    name: "YaoiScan",
    baseUrl: "https://yaoiscan.com",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
