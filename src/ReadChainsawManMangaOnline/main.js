import { ContentRating } from "@paperback/types";
import { MangaCatalogExtension } from "../utils/mangacatalog/template";
export const ReadChainsawManMangaOnline = new MangaCatalogExtension({
    name: "Read Chainsaw Man Manga Online",
    baseUrl: "https://ww6.readchainsawman.com",
    contentRating: ContentRating.MATURE,
    langCode: "🇬🇧",
    mangaList: [
        { title: "Chainsaw Man", url: "/manga/chainsaw-man/" },
        { title: "17-21", url: "/manga/17-21-fujimoto-tatsuki-tanpenshuu/" },
        { title: "Fire Punch", url: "/manga/fire-punch/" },
        { title: "Nayuta", url: "/manga/yogen-no-nayuta/" },
        { title: "Look Back", url: "/manga/look-back/" },
        { title: "Light Novel", url: "/manga/chainsaw-man-buddy-stories/" },
        { title: "Colored", url: "/manga/chainsaw-man-colored/" },
        { title: "Listen to Song", url: "/manga/futsuu-ni-kiite-kure/" },
        { title: "Goodbye, Eri", url: "/manga/sayonara-eri-goodbye-eri/" },
        { title: "22-26", url: "/manga/22-26-fujimoto-tatsuki-tanpenshuu/" },
        { title: "Chainsaw Man Colored", url: "/manga/chainsaw-man-colored/" },
        { title: "Chainsaw Man: Buddy Stories", url: "/manga/chainsaw-man-buddy-stories/" },
    ],
});
