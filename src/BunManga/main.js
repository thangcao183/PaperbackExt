import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const BunManga = new MadaraExtension({
    name: "Bun Manga",
    baseUrl: "https://bunmanga.com",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.EVERYONE,
    langCode: "🇬🇧",
    useLoadMoreRequest: true,
});
