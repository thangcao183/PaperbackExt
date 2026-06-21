import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface ComivexSearchMeta extends JSONObject {
  genre: string[];
  sort: string[];
  status: string[];
  type: string[];
}

export const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All Genres" },
  { id: "Action", title: "Action" },
  { id: "Adventure", title: "Adventure" },
  { id: "Comedy", title: "Comedy" },
  { id: "Cooking", title: "Cooking" },
  { id: "Drama", title: "Drama" },
  { id: "Fantasy", title: "Fantasy" },
  { id: "Gender bender", title: "Gender bender" },
  { id: "Harem", title: "Harem" },
  { id: "Historical", title: "Historical" },
  { id: "Horror", title: "Horror" },
  { id: "Isekai", title: "Isekai" },
  { id: "Josei", title: "Josei" },
  { id: "Manga", title: "Manga" },
  { id: "Manhua", title: "Manhua" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Martial arts", title: "Martial arts" },
  { id: "Mature", title: "Mature" },
  { id: "Mecha", title: "Mecha" },
  { id: "Medical", title: "Medical" },
  { id: "Mystery", title: "Mystery" },
  { id: "One shot", title: "One shot" },
  { id: "Psychological", title: "Psychological" },
  { id: "Romance", title: "Romance" },
  { id: "School life", title: "School life" },
  { id: "Sci fi", title: "Sci fi" },
  { id: "Seinen", title: "Seinen" },
  { id: "Shoujo", title: "Shoujo" },
  { id: "Shounen", title: "Shounen" },
  { id: "Slice of life", title: "Slice of life" },
  { id: "Sports", title: "Sports" },
  { id: "Supernatural", title: "Supernatural" },
  { id: "Thriller", title: "Thriller" },
  { id: "Tragedy", title: "Tragedy" },
  { id: "Webtoon", title: "Webtoon" },
];

export const SORT_OPTIONS: { id: string; title: string }[] = [
  { id: "Views", title: "Views" },
  { id: "Updated", title: "Updated" },
  { id: "New", title: "New" },
  { id: "Random", title: "Random" },
];

export const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
];

export const TYPE_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "All Types" },
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
];

export class ComivexSearchForm extends AdvancedSearchForm {
  private genre: string[];
  private sort: string[];
  private status: string[];
  private type: string[];

  constructor(initialMeta?: ComivexSearchMeta) {
    super();
    this.genre = initialMeta?.genre ?? [];
    this.sort = initialMeta?.sort ?? [];
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
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

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        genre: this.genre,
        sort: this.sort,
        status: this.status,
        type: this.type,
      } satisfies ComivexSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("genre", {
          title: "Genre",
          value: this.genre,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ComivexSearchForm,
            "updateGenre",
          ),
        }),
        SelectRow("sort", {
          title: "Sort By",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ComivexSearchForm,
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
            this as ComivexSearchForm,
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
            this as ComivexSearchForm,
            "updateType",
          ),
        }),
      ]),
    ];
  }
}
