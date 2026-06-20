import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const NyanuKafe = new KeyoappExtension({
  name: "Nyanu Kafe",
  baseUrl: "https://nyanukafe.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
