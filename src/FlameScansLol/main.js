import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const FlameScansLol = new MadaraExtension({
    name: "FlameScans.lol",
    baseUrl: "https://flamescans.lol",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
});
