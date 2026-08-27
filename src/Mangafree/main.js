import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const Mangafree = new MadaraExtension({
    name: "Mangafree",
    baseUrl: "https://mangafree.info",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
});
