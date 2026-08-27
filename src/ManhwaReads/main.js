import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const ManhwaReads = new MadaraExtension({
    name: "Manhwa Reads",
    baseUrl: "https://manhwareads.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
