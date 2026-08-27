import { ContentRating, SourceIntents } from "@paperback/types";
export default {
    name: "Gone with the Blastwave",
    description: "Gone with the Blastwave - webcomic source (blastwave-comic.com). Converted from keiyoushi.",
    version: "1.4.3.1",
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
