import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
// Upstream WebtoonXYZ overrides `popularMangaFromElement` (which
// `latestUpdatesFromElement` also delegates to) to strip the resized-image
// suffix (e.g. `-193x278.jpg`) from listing thumbnails, yielding the
// original full-resolution image. In the Paperback template both the
// "Popular" and "Latest Updates" discover sections flow through
// `getDiscoverSectionItems`, so we post-process their thumbnails there.
// Search results are untouched upstream (no `searchMangaFromElement`
// override), so `getSearchResults` is left as the base implementation.
const thumbnailOriginalUrlRegex = /-\d+x\d+(\.[a-zA-Z]+)$/;
class WebtoonXYZExtension extends MadaraExtension {
    async getDiscoverSectionItems(section, metadata) {
        const result = await super.getDiscoverSectionItems(section, metadata);
        return {
            ...result,
            items: result.items.map((item) => "imageUrl" in item && item.imageUrl
                ? {
                    ...item,
                    imageUrl: item.imageUrl.replace(thumbnailOriginalUrlRegex, "$1"),
                }
                : item),
        };
    }
}
export const WebtoonXYZ = new WebtoonXYZExtension({
    name: "WebtoonXYZ",
    baseUrl: "https://www.webtoon.xyz",
    mangaSubString: "read",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
