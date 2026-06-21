import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface MangaHereSearchMeta extends JSONObject {
  type: string[];
  completion: string[];
  rating: string[];
  includeGenres: string[];
  excludeGenres: string[];
  artist: string;
  author: string;
  year: string;
}

export const TYPE_OPTIONS = [
  { id: "1", title: "Japanese Manga" },
  { id: "2", title: "Korean Manhwa" },
  { id: "3", title: "Chinese Manhua" },
  { id: "4", title: "European Manga" },
  { id: "5", title: "American Manga" },
  { id: "6", title: "Hong Kong Manga" },
  { id: "7", title: "Other Manga" },
  { id: "0", title: "Any" },
];

export const COMPLETION_OPTIONS = [
  { id: "0", title: "Either" },
  { id: "1", title: "No" },
  { id: "2", title: "Yes" },
];

export const RATING_OPTIONS = [
  { id: "0", title: "No Stars" },
  { id: "1", title: "1 Star" },
  { id: "2", title: "2 Stars" },
  { id: "3", title: "3 Stars" },
  { id: "4", title: "4 Stars" },
  { id: "5", title: "5 Stars" },
];

export const GENRE_OPTIONS = [
  { id: "1", title: "Action" },
  { id: "2", title: "Adventure" },
  { id: "3", title: "Comedy" },
  { id: "4", title: "Fantasy" },
  { id: "5", title: "Historical" },
  { id: "6", title: "Horror" },
  { id: "7", title: "Martial Arts" },
  { id: "8", title: "Mystery" },
  { id: "9", title: "Romance" },
  { id: "10", title: "Shounen Ai" },
  { id: "11", title: "Supernatural" },
  { id: "12", title: "Drama" },
  { id: "13", title: "Shounen" },
  { id: "14", title: "School Life" },
  { id: "15", title: "Shoujo" },
  { id: "16", title: "Gender Bender" },
  { id: "17", title: "Josei" },
  { id: "18", title: "Psychological" },
  { id: "19", title: "Seinen" },
  { id: "20", title: "Slice of Life" },
  { id: "21", title: "Sci-fi" },
  { id: "22", title: "Ecchi" },
  { id: "23", title: "Harem" },
  { id: "24", title: "Shoujo Ai" },
  { id: "25", title: "Yuri" },
  { id: "26", title: "Mature" },
  { id: "27", title: "Tragedy" },
  { id: "28", title: "Yaoi" },
  { id: "29", title: "Doujinshi" },
  { id: "30", title: "Sports" },
  { id: "31", title: "Adult" },
  { id: "32", title: "One Shot" },
  { id: "33", title: "Smut" },
  { id: "34", title: "Mecha" },
  { id: "35", title: "Shotacon" },
  { id: "36", title: "Lolicon" },
  { id: "37", title: "Webtoons" },
];

export class MangaHereSearchForm extends AdvancedSearchForm {
  private type: string[];
  private completion: string[];
  private rating: string[];
  private includeGenres: string[];
  private excludeGenres: string[];
  private artist: string;
  private author: string;
  private year: string;

  constructor(initialMeta?: MangaHereSearchMeta) {
    super();
    this.type = initialMeta?.type ?? [];
    this.completion = initialMeta?.completion ?? [];
    this.rating = initialMeta?.rating ?? [];
    this.includeGenres = initialMeta?.includeGenres ?? [];
    this.excludeGenres = initialMeta?.excludeGenres ?? [];
    this.artist = initialMeta?.artist ?? "";
    this.author = initialMeta?.author ?? "";
    this.year = initialMeta?.year ?? "";
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value;
    this.reloadForm();
  }

  async updateCompletion(value: string[]): Promise<void> {
    this.completion = value;
    this.reloadForm();
  }

  async updateRating(value: string[]): Promise<void> {
    this.rating = value;
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

  async updateArtist(value: string): Promise<void> {
    this.artist = value;
    this.reloadForm();
  }

  async updateAuthor(value: string): Promise<void> {
    this.author = value;
    this.reloadForm();
  }

  async updateYear(value: string): Promise<void> {
    this.year = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        type: this.type,
        completion: this.completion,
        rating: this.rating,
        includeGenres: this.includeGenres,
        excludeGenres: this.excludeGenres,
        artist: this.artist,
        author: this.author,
        year: this.year,
      } satisfies MangaHereSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("type", {
          title: "Type",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHereSearchForm,
            "updateType",
          ),
        }),
        SelectRow("completion", {
          title: "Completed",
          value: this.completion,
          options: COMPLETION_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHereSearchForm,
            "updateCompletion",
          ),
        }),
        SelectRow("rating", {
          title: "Minimum Rating",
          value: this.rating,
          options: RATING_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHereSearchForm,
            "updateRating",
          ),
        }),
        SelectRow("include_genres", {
          title: "Include Genres",
          value: this.includeGenres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as MangaHereSearchForm,
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
            this as MangaHereSearchForm,
            "updateExcludeGenres",
          ),
        }),
        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector(
            this as MangaHereSearchForm,
            "updateArtist",
          ),
        }),
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as MangaHereSearchForm,
            "updateAuthor",
          ),
        }),
        InputRow("year", {
          title: "Year Released",
          value: this.year,
          onValueChange: Application.Selector(
            this as MangaHereSearchForm,
            "updateYear",
          ),
        }),
      ]),
    ];
  }
}
