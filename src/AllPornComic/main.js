import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const AllPornComic = new MadaraExtension({
    name: "AllPornComic",
    baseUrl: "https://allporncomic.com",
    mangaSubString: "porncomic",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
