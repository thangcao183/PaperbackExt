import { ContentRating, SourceIntents } from "@paperback/types";
export default {
    name: "Manga Mirai",
    description: "Manga Mirai - custom source (mangamirai.com). Converted from keiyoushi.",
    version: "1.4.1.1",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.EVERYONE,
    capabilities: [
        SourceIntents.DISCOVER_SECTION_PROVIDING,
        SourceIntents.SEARCH_RESULT_PROVIDING,
        SourceIntents.CHAPTER_PROVIDING,
        SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
        SourceIntents.SETTINGS_FORM_PROVIDING,
    ],
    badges: [],
    developers: [{ name: "nicartjay" }, { name: "keiyoushi" }],
};
