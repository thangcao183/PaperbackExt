import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface ComicKFanSearchMeta extends JSONObject {
  sort: string[];
  status: string[];
  type: string[];
  genres: string[];
}

export const SORT_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "latest", title: "Last Updated" },
  { id: "rating", title: "Rating" },
  { id: "bookmark", title: "Bookmark Count" },
  { id: "name_asc", title: "Name (A-Z)" },
  { id: "name_desc", title: "Name (Z-A)" },
];

export const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "1", title: "Ongoing" },
  { id: "2", title: "Completed" },
  { id: "3", title: "Cancelled" },
  { id: "4", title: "Hiatus" },
];

export const TYPE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "jp", title: "Manga" },
  { id: "kr", title: "Manhwa" },
  { id: "cn", title: "Manhua" },
];

const GENRE_SLUGS: string[] = [
  // Format
  "award-winning",
  "long-strip",
  "official-colored",
  "fan-colored",
  "anthology",
  "full-color",
  "4-koma",
  "user-created",
  "adaptation",
  "web-comic",
  "oneshot",
  "doujinshi",
  // Content
  "sexual-violence",
  "gore",
  "smut",
  "ecchi",
  // Theme
  "ninja",
  "virtual-reality",
  "police",
  "magic",
  "villainess",
  "traditional-games",
  "reincarnation",
  "zombies",
  "loli",
  "time-travel",
  "mafia",
  "music",
  "monsters",
  "post-apocalyptic",
  "office-workers",
  "monster-girls",
  "cooking",
  "video-games",
  "reverse-harem",
  "demons",
  "harem",
  "vampires",
  "shota",
  "incest",
  "delinquents",
  "gyaru",
  "animals",
  "military",
  "aliens",
  "survival",
  "ghosts",
  "crossdressing",
  "school-life",
  "martial-arts",
  "samurai",
  "genderswap",
  "supernatural",
  // Genre
  "fantasy",
  "wuxia",
  "drama",
  "sports",
  "psychological",
  "medical",
  "superhero",
  "gender-bender",
  "romance",
  "shoujo-ai",
  "tragedy",
  "slice-of-life",
  "shounen-ai",
  "isekai",
  "mecha",
  "adult",
  "magical-girls",
  "philosophical",
  "sci-fi",
  "thriller",
  "historical",
  "yaoi",
  "mature",
  "mystery",
  "adventure",
  "yuri",
  "comedy",
  "horror",
  "others",
  "crime",
  "action",
];

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export const GENRE_OPTIONS: { id: string; title: string }[] = GENRE_SLUGS.map(
  (s) => ({ id: s, title: slugToTitle(s) }),
);

export class ComicKFanSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private status: string[];
  private type: string[];
  private genres: string[];

  constructor(initialMeta?: ComicKFanSearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
    this.genres = initialMeta?.genres ?? [];
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value;
    this.reloadForm();
  }

  async updateGenres(value: string[]): Promise<void> {
    this.genres = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        sort: this.sort,
        status: this.status,
        type: this.type,
        genres: this.genres,
      } satisfies ComicKFanSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("sort", {
          title: "Sort By",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ComicKFanSearchForm,
            "updateSort",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ComicKFanSearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("type", {
          title: "Type",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ComicKFanSearchForm,
            "updateType",
          ),
        }),
        SelectRow("genres", {
          title: "Genres",
          value: this.genres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as ComicKFanSearchForm,
            "updateGenres",
          ),
        }),
      ]),
    ];
  }
}
