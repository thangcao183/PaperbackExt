import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const TopManhuaFan = new MadaraExtension({
    name: "TopManhua.fan",
    baseUrl: "https://www.topmanhua.fan",
    mangaSubString: "manhua",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    // Upstream overrides chapterListSelector to "div.wp-manga-chapter"
    // (base Madara default is "li.wp-manga-chapter").
    chapterListSelector: "div.wp-manga-chapter",
    // Upstream sets useLoadMoreRequest = LoadMoreStrategy.Never (template default).
    useLoadMoreRequest: false,
});
