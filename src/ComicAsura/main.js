import { ContentRating } from "@paperback/types";
import { MangaThemesiaExtension } from "../utils/mangathemesia/template";
export const ComicAsura = new MangaThemesiaExtension({
    name: "Comic Asura",
    baseUrl: "https://comicasura.net",
    mangaUrlDirectory: "/manga",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    // Comic Asura is a custom Next.js rebuild of Asura; browse lives at
    // /advanced-search and the selectors differ from standard MangaThemesia.
    browsePath: "/advanced-search",
    useAdvancedSearchParams: true,
    discoverItemSelector: ".grid > a[href*=manga]",
    seriesTitleSelector: ".comic-title-content",
    seriesThumbnailSelector: "img[alt=poster]",
    seriesDescriptionSelector: ".comic-content.mobile",
    seriesGenreSelector: "div:contains(Genres) + div > a",
    seriesStatusSelector: "div:contains(Status) + div",
    chapterSelector: ".chapter-items",
    chapterNameSelector: ".text-sm.text-white",
    chapterDateSelector: ".text-xs:not(:has(span))",
    pageSelector: "div > img.object-cover.mx-auto",
});
