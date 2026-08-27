import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const ManhwaNex = new MadaraExtension({
    name: "ManhwaNex",
    baseUrl: "https://manhwanex.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
