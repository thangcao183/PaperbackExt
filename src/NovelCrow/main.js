import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
class NovelCrowExtension extends MadaraExtension {
    // Faithful port of upstream imageFromElement: prefer the standard Madara
    // attribute chain, but if nothing usable is found fall back to
    // data-src / data-lazy-src / src and resolve the URL ourselves, preserving
    // absolute http(s) and inline data: URIs instead of prefixing the baseUrl.
    imageFromElement(img) {
        const image = super.imageFromElement(img).trim();
        if (image.length === 0) {
            const url = (img.attr("data-src")?.trim() ||
                img.attr("data-lazy-src")?.trim() ||
                img.attr("src")?.trim() ||
                "").trim();
            if (url.length > 0) {
                if (url.startsWith("http") || url.startsWith("data:")) {
                    return url;
                }
                return url.startsWith("/")
                    ? `${this.baseUrl}${url}`
                    : `${this.baseUrl}/${url}`;
            }
        }
        return image;
    }
}
export const NovelCrow = new NovelCrowExtension({
    name: "NovelCrow",
    baseUrl: "https://novelcrow.com",
    mangaSubString: "comic",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    chapterUrlSuffix: "",
});
