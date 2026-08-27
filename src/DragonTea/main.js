import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const DragonTea = new MadaraExtension({
    name: "DragonTea",
    baseUrl: "https://dragontea.ink",
    mangaSubString: "novel",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
