import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const SetsuScans = new MadaraExtension({
    name: "Setsu Scans",
    baseUrl: "https://setsuscans.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
    mangaDetailsStatusSelector: "div.summary-heading:contains(status) + div.summary-content",
});
