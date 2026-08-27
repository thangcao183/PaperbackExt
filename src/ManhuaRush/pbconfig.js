import { ContentRating, SourceIntents } from "@paperback/types";
export default {
    name: "Manhua Rush",
    description: "Manhua Rush - webcomic source (manhuarush.vercel.app). Converted from keiyoushi.",
    version: "1.4.2.1",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.EVERYONE,
    capabilities: [
        SourceIntents.DISCOVER_SECTION_PROVIDING,
        SourceIntents.SEARCH_RESULT_PROVIDING,
        SourceIntents.CHAPTER_PROVIDING,
        SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
    ],
    badges: [],
    developers: [{ name: "nicartjay" }, { name: "keiyoushi" }],
};
