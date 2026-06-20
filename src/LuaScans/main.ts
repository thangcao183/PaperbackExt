import { ContentRating } from "@paperback/types";
import { HeanCmsExtension } from "../utils/heancms/template";

export const LuaScans = new HeanCmsExtension({
  name: "Lua Scans",
  baseUrl: "https://luacomic.org",
  useNewChapterEndpoint: true,
  latestSortBy: "asc",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
