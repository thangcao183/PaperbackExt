import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const TopManhuaNet = new MadaraExtension({
    name: "TopManhua.net",
    baseUrl: "https://topmanhua.net",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
