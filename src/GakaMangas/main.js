import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const GakaMangas = new MadaraExtension({
    name: "GakaMangas",
    baseUrl: "https://gakamangas.com",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    filterNonMangaItems: false,
});
