import { ContentRating } from "@paperback/types";
import { MonochromeExtension } from "../utils/monochrome/template";

export const MonochromeCustom = new MonochromeExtension({
  name: "Monochrome Custom",
  baseUrl: "https://monochromecms.netlify.app",
  apiUrl: "https://api-3qnqyl7llq-lz.a.run.app",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
});
