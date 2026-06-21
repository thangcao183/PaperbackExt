import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaKatanaSearchMeta extends JSONObject {
  searchBy: string[];
  includeGenres: string[];
  excludeGenres: string[];
  includeMode: string[];
  order: string[];
  status: string[];
  minChapters: string;
}

// keiyoushi TypeFilter: Title=book_name, Author=author
export const SEARCH_BY_OPTIONS = [
  { id: "book_name", title: "Title" },
  { id: "author", title: "Author" },
];

// keiyoushi genre list (id = slug used in include/exclude query params)
export const GENRE_OPTIONS = [
  { id: "4-koma", title: "4 koma" },
  { id: "action", title: "Action" },
  { id: "adult", title: "Adult" },
  { id: "adventure", title: "Adventure" },
  { id: "artbook", title: "Artbook" },
  { id: "award-winning", title: "Award winning" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "erotica", title: "Erotica" },
  { id: "fantasy", title: "Fantasy" },
  { id: "gender-bender", title: "Gender Bender" },
  { id: "gore", title: "Gore" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "isekai", title: "Isekai" },
  { id: "josei", title: "Josei" },
  { id: "loli", title: "Loli" },
  { id: "manhua", title: "Manhua" },
  { id: "manhwa", title: "Manhwa" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "mecha", title: "Mecha" },
  { id: "medical", title: "Medical" },
  { id: "music", title: "Music" },
  { id: "mystery", title: "Mystery" },
  { id: "one-shot", title: "One shot" },
  { id: "overpowered-mc", title: "Overpowered MC" },
  { id: "psychological", title: "Psychological" },
  { id: "reincarnation", title: "Reincarnation" },
  { id: "romance", title: "Romance" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-fi" },
  { id: "seinen", title: "Seinen" },
  { id: "sexual-violence", title: "Sexual violence" },
  { id: "shota", title: "Shota" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shoujo-ai", title: "Shoujo Ai" },
  { id: "shounen", title: "Shounen" },
  { id: "shounen-ai", title: "Shounen Ai" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "sports", title: "Sports" },
  { id: "super-power", title: "Super power" },
  { id: "supernatural", title: "Supernatural" },
  { id: "survival", title: "Survival" },
  { id: "time-travel", title: "Time Travel" },
  { id: "tragedy", title: "Tragedy" },
  { id: "webtoon", title: "Webtoon" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
];

export const INCLUDE_MODE_OPTIONS = [
  { id: "and", title: "And" },
  { id: "or", title: "Or" },
];

export const ORDER_OPTIONS = [
  { id: "latest", title: "Latest update" },
  { id: "new", title: "New manga" },
  { id: "az", title: "A-Z" },
  { id: "numc", title: "Number of chapters" },
];

export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "0", title: "Cancelled" },
  { id: "1", title: "Ongoing" },
  { id: "2", title: "Completed" },
];

export class MangaKatanaSearchForm extends AdvancedSearchForm {
  private searchBy: string[];
  private includeGenres: string[];
  private excludeGenres: string[];
  private includeMode: string[];
  private order: string[];
  private status: string[];
  private minChapters: string;

  constructor(initialMeta?: MangaKatanaSearchMeta) {
    super();
    this.searchBy = initialMeta?.searchBy ?? [];
    this.includeGenres = initialMeta?.includeGenres ?? [];
    this.excludeGenres = initialMeta?.excludeGenres ?? [];
    this.includeMode = initialMeta?.includeMode ?? [];
    this.order = initialMeta?.order ?? [];
    this.status = initialMeta?.status ?? [];
    this.minChapters = initialMeta?.minChapters ?? "";
  }

  async updateSearchBy(value: string[]): Promise<void> {
    this.searchBy = value;
    this.reloadForm();
  }

  async updateIncludeGenres(value: string[]): Promise<void> {
    this.includeGenres = value;
    this.reloadForm();
  }

  async updateExcludeGenres(value: string[]): Promise<void> {
    this.excludeGenres = value;
    this.reloadForm();
  }

  async updateIncludeMode(value: string[]): Promise<void> {
    this.includeMode = value;
    this.reloadForm();
  }

  async updateOrder(value: string[]): Promise<void> {
    this.order = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateMinChapters(value: string): Promise<void> {
    this.minChapters = value;
    this.reloadForm();
  }

  override getSearchQueryMetadata(): MangaKatanaSearchMeta {
    return {
      searchBy: this.searchBy,
      includeGenres: this.includeGenres,
      excludeGenres: this.excludeGenres,
      includeMode: this.includeMode,
      order: this.order,
      status: this.status,
      minChapters: this.minChapters,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("search_by", {
          title: "Text search by",
          value: this.searchBy,
          options: SEARCH_BY_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaKatanaSearchForm,
            "updateSearchBy",
          ),
        }),
        SelectRow("include_genres", {
          title: "Include Genres",
          value: this.includeGenres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as MangaKatanaSearchForm,
            "updateIncludeGenres",
          ),
        }),
        SelectRow("exclude_genres", {
          title: "Exclude Genres",
          value: this.excludeGenres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as MangaKatanaSearchForm,
            "updateExcludeGenres",
          ),
        }),
        SelectRow("include_mode", {
          title: "Genre inclusion mode",
          value: this.includeMode,
          options: INCLUDE_MODE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaKatanaSearchForm,
            "updateIncludeMode",
          ),
        }),
        SelectRow("order", {
          title: "Sort by",
          value: this.order,
          options: ORDER_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaKatanaSearchForm,
            "updateOrder",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaKatanaSearchForm,
            "updateStatus",
          ),
        }),
        InputRow("min_chapters", {
          title: "Minimum Chapters (-1 for oneshots only)",
          value: this.minChapters,
          onValueChange: Application.Selector(
            this as MangaKatanaSearchForm,
            "updateMinChapters",
          ),
        }),
      ]),
    ];
  }
}
