import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const GenzToons = new KeyoappExtension({
  name: "Genz Toons",
  baseUrl: "https://genztoons.org",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
