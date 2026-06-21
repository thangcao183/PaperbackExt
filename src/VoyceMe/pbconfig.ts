import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Voyce.Me",
  description:
    "Voyce.Me - GraphQL API source (voyce.me). Converted from keiyoushi.",
  version: "1.4.6.1",
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
