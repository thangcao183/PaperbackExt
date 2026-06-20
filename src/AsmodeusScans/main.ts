import { ContentRating } from "@paperback/types";
import { KeyoappExtension } from "../utils/keyoapp/template";

export const AsmodeusScans = new KeyoappExtension({
  name: "Asmodeus Scans",
  baseUrl: "https://asmotoon.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
