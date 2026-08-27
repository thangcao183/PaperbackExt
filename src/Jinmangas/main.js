import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const Jinmangas = new MadaraExtension({
    name: "Jinmangas",
    baseUrl: "https://jinmangas.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
});
