import { ContentRating } from "@paperback/types";
import { MadaraExtension } from "../utils/madara/template";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

class CoffeeMangaExtension extends MadaraExtension {
  // Faithful port of upstream `imageFromElement`. The only difference from the
  // base Madara behaviour is that this site does NOT consider `data-manga-src`:
  // the priority is data-src -> data-lazy-src -> srcset (best) -> data-cfsrc ->
  // src, treating blank attribute values as absent (upstream `isNotBlank()`).
  protected override imageFromElement(img: Cheerio<AnyNode>): string {
    if (!img || img.length === 0) return "";

    const attr = (name: string): string => (img.attr(name) ?? "").trim();

    let src = "";
    const dataSrc = attr("data-src");
    const dataLazySrc = attr("data-lazy-src");
    const srcset = attr("srcset");
    const dataCfsrc = attr("data-cfsrc");

    if (dataSrc) {
      src = dataSrc;
    } else if (dataLazySrc) {
      src = dataLazySrc;
    } else if (srcset) {
      const candidates = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/))
        .map(([u, w]) => ({
          url: u,
          width: parseInt((w || "0").replace(/\D/g, "")) || 0,
        }));
      candidates.sort((a, b) => b.width - a.width);
      if (candidates.length > 0) src = candidates[0].url;
    } else if (dataCfsrc) {
      src = dataCfsrc;
    } else {
      src = attr("src");
    }

    src = src.trim();
    if (src && !src.startsWith("http")) {
      src = src.startsWith("/")
        ? `${this.baseUrl}${src}`
        : `${this.baseUrl}/${src}`;
    }
    return src;
  }
}

export const CoffeeManga = new CoffeeMangaExtension({
  name: "Coffee Manga",
  baseUrl: "https://coffeemanga.ink",
  useNewChapterEndpoint: false,
  contentRating: ContentRating.MATURE,
  langCode: "🇬🇧",
});
