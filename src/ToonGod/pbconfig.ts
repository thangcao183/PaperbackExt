import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "ToonGod",
  description: "ToonGod - Madara source (www.toongod.org). Converted from keiyoushi.",
  version: "1.4.56",
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
