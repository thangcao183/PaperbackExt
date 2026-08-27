import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const APComics = new MadaraExtension({
    name: "AP Comics",
    baseUrl: "https://apcomics.org",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
