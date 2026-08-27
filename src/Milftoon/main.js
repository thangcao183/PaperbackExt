import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const Milftoon = new MadaraExtension({
    name: "Milftoon",
    baseUrl: "https://milftoon.xxx",
    mangaSubString: "comics",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
