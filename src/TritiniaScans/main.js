import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const TritiniaScans = new MadaraExtension({
    name: "TritiniaScans",
    baseUrl: "https://tritinia.org",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
});
