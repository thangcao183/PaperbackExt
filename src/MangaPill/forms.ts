import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaPillSearchMeta extends JSONObject {
  status: string[];
  type: string[];
  genres: string[];
}

export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "publishing", title: "Publishing" },
  { id: "finished", title: "Finished" },
  { id: "on hiatus", title: "On Hiatus" },
  { id: "discontinued", title: "Discontinued" },
  { id: "not yet published", title: "Not yet Published" },
];

export const TYPE_OPTIONS = [
  { id: "", title: "All" },
  { id: "manga", title: "Manga" },
  { id: "novel", title: "Novel" },
  { id: "one-shot", title: "One-Shot" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "oel", title: "Oel" },
];

export const GENRE_OPTIONS = [
  "Action",
  "Adventure",
  "Cars",
  "Comedy",
  "Dementia",
  "Demons",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Josei",
  "Kids",
  "Magic",
  "Martial Arts",
  "Mecha",
  "Military",
  "Music",
  "Mystery",
  "Parody",
  "Police",
  "Psychological",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Space",
  "Sports",
  "Super Power",
  "Supernatural",
  "Thriller",
  "Vampire",
  "Yaoi",
  "Yuri",
].map((g) => ({ id: g, title: g }));

export class MangaPillSearchForm extends AdvancedSearchForm {
  private status: string[];
  private type: string[];
  private genres: string[];

  constructor(initialMeta?: MangaPillSearchMeta) {
    super();
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
    this.genres = initialMeta?.genres ?? [];
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
        status: this.status,
        type: this.type,
        genres: this.genres,
      } satisfies MangaPillSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaPillSearchForm,
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
            this as MangaPillSearchForm,
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
            this as MangaPillSearchForm,
            "updateGenres",
          ),
        }),
      ]),
    ];
  }
}
