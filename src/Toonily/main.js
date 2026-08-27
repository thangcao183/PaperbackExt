import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
// Upstream `titleSpecialCharactersRegex = "[^a-z0-9]+"`: any run of characters
// that are not lowercase letters or digits (this notably includes uppercase
// letters) is collapsed into a single space.
const TITLE_SPECIAL_CHARACTERS_REGEX = /[^a-z0-9]+/g;
class ToonilyExtension extends MadaraExtension {
    // Faithful port of upstream `searchMangaRequest`, which rewrites the query
    // before issuing the standard Madara search request.
    async getSearchResults(query, metadata, sortingOption) {
        const normalizedTitle = (query.title ?? "")
            .replace(TITLE_SPECIAL_CHARACTERS_REGEX, " ")
            .trim();
        return super.getSearchResults({ ...query, title: normalizedTitle }, metadata, sortingOption);
    }
}
export const Toonily = new ToonilyExtension({
    name: "Toonily",
    baseUrl: "https://toonily.com",
    mangaSubString: "serie",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
    filterNonMangaItems: false,
    mangaDetailsDescriptionSelector: "div.content-area div.summary__content",
});
