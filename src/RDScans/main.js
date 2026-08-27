import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
/**
 * RD Scans applies a custom listing filter on top of the generic Madara
 * behavior: it drops entries whose title contains "(WN)" (web novels) from
 * the popular, latest, and search results. The page list also uses a custom
 * image selector (`div.reading-content .separator img`), which is handled via
 * the `pageListSelector` config knob below.
 */
class RDScansExtension extends MadaraExtension {
    /** Upstream `filterWebNovels`: exclude titles containing "(WN)". */
    isWebNovel(title) {
        return title.toLowerCase().includes("(wn)");
    }
    async getDiscoverSectionItems(section, metadata) {
        const result = await super.getDiscoverSectionItems(section, metadata);
        return {
            ...result,
            items: result.items.filter((item) => !this.isWebNovel("title" in item ? (item.title ?? "") : "")),
        };
    }
    async getSearchResults(query, metadata, sortingOption) {
        const result = await super.getSearchResults(query, metadata, sortingOption);
        return {
            ...result,
            items: result.items.filter((item) => !this.isWebNovel(item.title ?? "")),
        };
    }
}
export const RDScans = new RDScansExtension({
    name: "RD Scans",
    baseUrl: "https://rdscans.com",
    mangaSubString: "new",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    // Upstream `pageListParse`: pages come from `div.reading-content .separator img`.
    pageListSelector: "div.reading-content .separator img",
});
