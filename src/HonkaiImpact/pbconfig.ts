import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Honkai Impact 3rd",
  description:
    "Honkai Impact 3rd - custom source (manga.honkaiimpact3.com). Converted from keiyoushi.",
  version: "1.4.4.1",
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
} satisfies ExtensionInfo;
