import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const ManhuaZonghe = new MadaraExtension({
    name: "Manhua Zonghe",
    baseUrl: "https://www.manhuazonghe.com",
    mangaSubString: "manhua",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    filterNonMangaItems: false,
});
