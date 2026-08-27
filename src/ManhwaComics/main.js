import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const ManhwaComics = new MadaraExtension({
    name: "Manhwa Comics",
    baseUrl: "https://manhwacomics.com",
    mangaSubString: "manhwa",
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
