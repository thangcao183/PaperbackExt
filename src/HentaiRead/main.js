import { ContentRating, } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import { URLBuilder } from "../utils/url-builder/base";
// Inline "No Cover" placeholder (300x450, #23282f) used when the detail page
// has no resolvable cover. Paperback throws "Invalid URL" on an empty
// thumbnailUrl, and keiyoushi never sets one here (Tachiyomi reuses the list
// cover, which Paperback cannot carry over).
const PLACEHOLDER_COVER = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNDUwIiB2aWV3Qm94PSIwIDAgMzAwIDQ1MCI+PHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSI0NTAiIGZpbGw9IiMyMzI4MmYiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZmlsbD0iIzhhOTBhNiIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMjQiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5ObyBDb3ZlcjwvdGV4dD48L3N2Zz4=";
class HentaiReadExtension extends MadaraExtension {
    // chapterExtraData = ({...});
    chapterExtraDataRegex = /= (\{[^;]+)/;
    // window.mMjM5MjM2 = '(eyJkYX...);
    pagesDataRegex = /.(ey\S+).\s/;
    // ----------------------------------------------------------------
    // Manga details (upstream `mangaDetailsParse`)
    // ----------------------------------------------------------------
    async getMangaDetails(mangaId) {
        const url = new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubString)
            .addPath(mangaId)
            .build();
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const capitalizeEach = (s) => s
            .split(" ")
            .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(" ");
        const eachText = (selector) => {
            const out = [];
            $(selector).each((_, el) => {
                const t = $(el).text().trim();
                out.push(t);
            });
            return out;
        };
        const title = $(this.mangaDetailsTitleSelector).first().text().trim();
        const authors = eachText("a[href*=/circle/] span:first-of-type").join(", ");
        const artists = eachText("a[href*=/artist/] span:first-of-type").join(", ");
        const genres = eachText("a[href*=/tag/] span:first-of-type");
        const characters = eachText("a[href*=/characters/] span:first-of-type").join(", ");
        const parodies = eachText("a[href*=/parody/] span:first-of-type").join(", ");
        const circles = eachText("a[href*=/circle/] span:first-of-type").join(", ");
        const conventions = eachText("a[href*=/convention/] span:first-of-type").join(", ");
        const scanlators = eachText("a[href*=/scanlator/] span:first-of-type").join(", ");
        let description = "";
        if (characters) {
            description += `Characters: ${capitalizeEach(characters)}\n\n`;
        }
        if (parodies) {
            description += `Parodies: ${capitalizeEach(parodies)}\n\n`;
        }
        if (circles) {
            description += `Circles: ${capitalizeEach(circles)}\n\n`;
        }
        if (conventions) {
            description += `Convention: ${capitalizeEach(conventions)}\n\n`;
        }
        if (scanlators) {
            description += `Scanlators: ${capitalizeEach(scanlators)}\n\n`;
        }
        const altTitlesText = $(".manga-titles h2").first().text();
        const secondaryTitles = [];
        if (altTitlesText) {
            const parts = altTitlesText.split("|").map((t) => t.trim());
            description += `Alternative Titles: \n${parts
                .map((t) => `- ${t}`)
                .join("\n")}\n\n`;
            for (const p of parts) {
                if (p)
                    secondaryTitles.push(p);
            }
        }
        description += `${$(".items-center:contains(pages:)").text()}\n`;
        // HentaiRead's detail page uses a custom theme, and keiyoushi never sets a
        // detail thumbnail (Tachiyomi reuses the list cover). The main cover sits in
        // `a.image--hover img`; og:image carries the same cover at full resolution.
        // We avoid `.manga-item__img*` selectors here because those match the
        // related/recommended sidebar items, not the current title.
        let image = $('meta[property="og:image"]').attr("content")?.trim() ??
            $('meta[name="twitter:image"]').attr("content")?.trim() ??
            "";
        if (!image) {
            const coverSelectors = [
                this.mangaDetailsThumbnailSelector ?? "",
                "a.image--hover img",
                ".manga-cover img",
                "div.summary_image img",
            ];
            for (const sel of coverSelectors) {
                if (!sel)
                    continue;
                const candidate = this.imageFromElement($(sel).first());
                if (candidate) {
                    image = candidate;
                    break;
                }
            }
        }
        if (!image) {
            image = PLACEHOLDER_COVER;
        }
        return {
            mangaId,
            mangaInfo: {
                primaryTitle: title,
                secondaryTitles,
                thumbnailUrl: image,
                author: authors || artists || undefined,
                artist: artists || authors || undefined,
                synopsis: description,
                rating: 0,
                contentRating: this.contentRating,
                status: "Completed",
                tagGroups: genres.length > 0
                    ? [
                        {
                            id: "genres",
                            title: "Genres",
                            tags: genres.map((g) => ({
                                id: g.toLowerCase().replace(/\s+/g, "-"),
                                title: g,
                            })),
                        },
                    ]
                    : [],
                shareUrl: url,
            },
        };
    }
    // ----------------------------------------------------------------
    // Chapters (upstream `fetchChapterList`)
    //
    // The site exposes each entry as a single "chapter" pointing back at the
    // manga URL; the scanlator is lifted out of the description text.
    // ----------------------------------------------------------------
    async getChapters(sourceManga) {
        const synopsis = sourceManga.mangaInfo.synopsis ?? "";
        let title = "Chapter";
        if (synopsis.includes("Scanlators")) {
            const scan = synopsis.split("Scanlators: ")[1]?.split("\n")[0]?.trim();
            if (scan)
                title = scan;
        }
        return [
            {
                chapterId: sourceManga.mangaId,
                sourceManga,
                title,
                volume: 0,
                chapNum: 1,
                publishDate: new Date(),
                langCode: this.langCode,
            },
        ];
    }
    // ----------------------------------------------------------------
    // Chapter details (upstream `pageListRequest` + `pageListParse`)
    //
    // Page URL is `{mangaUrl}english/p/1/`. The image base URL and the
    // base64-encoded page list are embedded in inline scripts.
    // ----------------------------------------------------------------
    async getChapterDetails(chapter) {
        const mangaUrl = new URLBuilder(this.baseUrl)
            .addPath(this.mangaSubString)
            .addPath(chapter.sourceManga.mangaId)
            .build();
        // There's like 2 non-English entries where this breaks.
        const url = `${mangaUrl}/english/p/1/`;
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const extraData = $("[id=single-chapter-js-extra]").first().text();
        const baseMatch = this.chapterExtraDataRegex.exec(extraData);
        let pageBaseUrl = "";
        if (baseMatch?.[1]) {
            const dto = JSON.parse(baseMatch[1]);
            pageBaseUrl = dto.baseUrl;
        }
        const beforeData = $("[id=single-chapter-js-before]").first().text();
        const pagesMatch = this.pagesDataRegex.exec(beforeData);
        if (!pagesMatch?.[1]) {
            throw new Error("Failed to find page list. Non-English entries are not supported.");
        }
        const decoded = Application.base64Decode(pagesMatch[1]);
        const decodedStr = typeof decoded === "string"
            ? decoded
            : Application.arrayBufferToUTF8String(decoded);
        const pagesDto = JSON.parse(decodedStr);
        const pages = pagesDto.data.chapter.images.map((img) => `${pageBaseUrl}/${img.src}`);
        return {
            id: chapter.chapterId,
            mangaId: chapter.sourceManga.mangaId,
            pages,
        };
    }
    // ----------------------------------------------------------------
    // Search (upstream `searchMangaRequest` + `searchMangaParse`)
    //
    // searchMangaParse delegates to popularMangaParse, so results use the
    // `.manga-item` container with the `a.manga-item__link` anchor. The
    // request builds `{baseUrl}/page/{page}?s=query&title-type=contains`.
    // ----------------------------------------------------------------
    async getSearchResults(query, metadata, _sortingOption) {
        const meta = metadata;
        const page = meta?.page ?? 1;
        const collectedIds = meta?.searchCollectedIds ?? [];
        const titleQuery = (query.title || "").trim();
        const url = new URLBuilder(this.baseUrl)
            .addPath("page")
            .addPath(page.toString())
            .addQuery("s", encodeURIComponent(titleQuery))
            .addQuery("title-type", "contains")
            .build();
        const $ = await this.fetchCheerio({ url, method: "GET" });
        const results = [];
        $(".manga-item").each((_, element) => {
            const unit = $(element);
            const titleLink = unit.find(this.popularMangaUrlSelector).first();
            const title = titleLink.text().trim() || titleLink.attr("title") || "";
            const href = titleLink.attr("href") || "";
            const mangaId = this.parseMangaId(href);
            const image = this.imageFromElement(unit.find("img").first());
            if (title && mangaId && !collectedIds.includes(mangaId)) {
                collectedIds.push(mangaId);
                results.push({
                    mangaId,
                    imageUrl: image,
                    title,
                    subtitle: undefined,
                    metadata: undefined,
                });
            }
        });
        // Upstream popular/search next-page selector is `a[rel=next]`.
        const hasNextPage = $("a[rel=next]").length > 0;
        const reachedPageLimit = page >= MadaraExtension.MAX_SEARCH_PAGES;
        return {
            items: results,
            metadata: hasNextPage && !reachedPageLimit
                ? { page: page + 1, searchCollectedIds: collectedIds }
                : undefined,
        };
    }
}
export const HentaiRead = new HentaiReadExtension({
    name: "HentaiRead",
    baseUrl: "https://hentairead.com",
    mangaSubString: "hentai",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    popularMangaUrlSelector: "a.manga-item__link",
    discoverItemSelector: ".manga-item",
    mangaDetailsTitleSelector: ".manga-titles h1",
});
