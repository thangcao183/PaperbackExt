import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Bun Manga",
  description: "Bun Manga - Madara source (bunmanga.com). Converted from keiyoushi.",
  version: "1.4.51",
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
  developers: [
    {
      name: "Converted from keiyoushi",
    },
  ],
} satisfies ExtensionInfo;
