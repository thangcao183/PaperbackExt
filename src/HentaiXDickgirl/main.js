import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
export const HentaiXDickgirl = new MadaraExtension({
    name: "HentaiXDickgirl",
    baseUrl: "https://hentaixdickgirl.com",
    useNewChapterEndpoint: false,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
