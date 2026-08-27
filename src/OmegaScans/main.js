import { ContentRating } from "@paperback/types";
import { HeanCmsExtension } from "../utils/heancms/template";
export const OmegaScans = new HeanCmsExtension({
    name: "Omega Scans",
    baseUrl: "https://omegascans.org",
    useNewQueryEndpoint: true,
    useNewChapterEndpoint: true,
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
});
