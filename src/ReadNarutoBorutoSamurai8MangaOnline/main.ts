import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";

export const ReadNarutoBorutoSamurai8MangaOnline = new MangaCatalogExtension({
  name: "Read Naruto Boruto Samurai 8 Manga Online",
  baseUrl: "https://ww11.readnaruto.com",
  contentRating: ContentRating.EVERYONE,
  langCode: "🇬🇧",
  mangaList: [
    { title: "Boruto - Two Blue Vortex", url: "/manga/boruto-two-blue-vortex/" },
    { title: "Naruto", url: "/manga/naruto/" },
    { title: "Naruto Colored", url: "/manga/naruto-digital-colored-comics/" },
    { title: "Naruto Gaiden", url: "/manga/naruto-gaiden-the-seventh-hokage/" },
    { title: "Boruto", url: "/manga/boruto-naruto-next-generations/" },
    { title: "Samurai 8", url: "/manga/samurai-8-hachimaru-den/" },
    { title: "Rock Lee SpinOff", url: "/manga/rock-lee-no-seishun-full-power-ninden/" },
    { title: "Chibi Sasuke", url: "/manga/uchiha-sasuke-no-sharingan-den/" },
    { title: "Sasuke Story", url: "/manga/naruto-sasuke-retsuden-uchiha-no-matsuei-to-tenkyuu-no-hoshikuzu/" },
  ],
});
