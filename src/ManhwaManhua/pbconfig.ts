import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "ManhwaManhua",
  description: "ManhwaManhua - Madara source (manhwamanhua.com). Converted from keiyoushi.",
  version: "1.4.51",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
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
