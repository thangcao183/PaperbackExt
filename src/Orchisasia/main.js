import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const Orchisasia = new MadaraExtension({
    name: "Orchisasia",
    baseUrl: "https://www.orchisasia.org",
    mangaSubString: "comic",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
