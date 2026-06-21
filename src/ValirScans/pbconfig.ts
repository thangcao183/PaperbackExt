import { ContentRating, ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Valir Scans",
  description:
    "Valir Scans - Next.js (RSC) HTML source (valirscans.org). Converted from keiyoushi.",
  version: "1.4.22.1",
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
