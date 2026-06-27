import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "VIZ",
  description:
    "VIZ - official manga reader source (viz.com). Converted from keiyoushi.",
  version: "1.4.25.6",
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
