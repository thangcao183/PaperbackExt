import { ContentRating } from "@paperback/types";
import { MangAdventureExtension } from "../utils/mangadventure/template";

export const ArcRelight = new MangAdventureExtension({
  name: "Arc-Relight",
  baseUrl: "https://arc-relight.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
