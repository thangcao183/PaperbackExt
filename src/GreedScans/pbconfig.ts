import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Greed Scans",
  description:
    "Greed Scans - JSON API source (gojoscans.com). Converted from keiyoushi.",
  version: "1.4.32.1",
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
  developers: [{ name: "Converted from keiyoushi" }],
} satisfies ExtensionInfo;
