import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";
import { type MangaKGenre } from "./settings";

export const SORT_OPTIONS = [
  { id: "", title: "Best Match" },
  { id: "popular", title: "Most Followed" },
  { id: "latest", title: "Latest Updated" },
  { id: "newest", title: "Recently Added" },
  { id: "rating", title: "Highest Rating" },
  { id: "views_today", title: "Most Viewed: Today" },
  { id: "views_7days", title: "Most Viewed: 7 Days" },
  { id: "views_30days", title: "Most Viewed: 30 Days" },
  { id: "views", title: "Most Viewed: All Time" },
  { id: "chapters", title: "Most Chapters" },
  { id: "alphabetical", title: "A-Z" },
];

export const CONTENT_RATING_OPTIONS = [
  { id: "", title: "Any" },
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const STATUS_OPTIONS = [
  { id: "", title: "Any" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const TYPE_OPTIONS = [
  { id: "", title: "Any" },
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
];

export const DEMOGRAPHIC_OPTIONS = [
  { id: "", title: "Any" },
  { id: "shounen,seinen", title: "Boy (Shounen + Seinen)" },
  { id: "shoujo,josei", title: "Girl (Shoujo + Josei)" },
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
];

export interface MangaKSearchMeta extends JSONObject {
  sort: string[];
  contentRating: string[];
  status: string[];
  type: string[];
  demographic: string[];
  author: string;
  minChapters: string;
  includedGenres: string[];
  excludedGenres: string[];
}

export class MangaKSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private contentRating: string[];
  private status: string[];
  private type: string[];
  private demographic: string[];
  private author: string;
  private minChapters: string;
  private includedGenres: string[];
  private excludedGenres: string[];

  constructor(
    private readonly genres: MangaKGenre[],
    initialMeta?: MangaKSearchMeta,
  ) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.contentRating = initialMeta?.contentRating ?? [];
    this.status = initialMeta?.status ?? [];
    this.type = initialMeta?.type ?? [];
    this.demographic = initialMeta?.demographic ?? [];
    this.author = initialMeta?.author ?? "";
    this.minChapters = initialMeta?.minChapters ?? "";
    this.includedGenres = initialMeta?.includedGenres ?? [];
    this.excludedGenres = initialMeta?.excludedGenres ?? [];
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateContentRating(value: string[]): Promise<void> {
    this.contentRating = value;
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

  async updateDemographic(value: string[]): Promise<void> {
    this.demographic = value;
    this.reloadForm();
  }

  async updateAuthor(value: string): Promise<void> {
    this.author = value;
    this.reloadForm();
  }

  async updateMinChapters(value: string): Promise<void> {
    this.minChapters = value;
    this.reloadForm();
  }

  async updateIncludedGenres(value: string[]): Promise<void> {
    this.includedGenres = value;
    // An explicitly included genre must never also be excluded.
    this.excludedGenres = this.excludedGenres.filter(
      (id) => !value.includes(id),
    );
    this.reloadForm();
  }

  async updateExcludedGenres(value: string[]): Promise<void> {
    this.excludedGenres = value;
    this.includedGenres = this.includedGenres.filter(
      (id) => !value.includes(id),
    );
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        sort: this.sort,
        contentRating: this.contentRating,
        status: this.status,
        type: this.type,
        demographic: this.demographic,
        author: this.author,
        minChapters: this.minChapters,
        includedGenres: this.includedGenres,
        excludedGenres: this.excludedGenres,
      } satisfies MangaKSearchMeta,
    };
  }

  override getSections() {
    const sections = [
      Section("select_filters", [
        SelectRow("sort", {
          title: "Sort By",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangaKSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateSort"),
        }),
        SelectRow("content_rating", {
          title: "Content Rating",
          value: this.contentRating,
          options: CONTENT_RATING_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangaKSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateContentRating"),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangaKSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateStatus"),
        }),
        SelectRow("type", {
          title: "Type",
          value: this.type,
          options: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangaKSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateType"),
        }),
        SelectRow("demographic", {
          title: "Demographics",
          value: this.demographic,
          options: DEMOGRAPHIC_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector<
            MangaKSearchForm,
            (value: string[]) => Promise<void>
          >(this, "updateDemographic"),
        }),
      ]),
      Section("text_filters", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector<
            MangaKSearchForm,
            (value: string) => Promise<void>
          >(this, "updateAuthor"),
        }),
        InputRow("min_ch", {
          title: "Min Chapters",
          value: this.minChapters,
          onValueChange: Application.Selector<
            MangaKSearchForm,
            (value: string) => Promise<void>
          >(this, "updateMinChapters"),
        }),
      ]),
    ];

    if (this.genres.length > 0) {
      sections.push(
        Section(
          {
            id: "genre_filters",
            footer:
              "Genres selected in the settings blacklist are always excluded.",
          },
          [
            SelectRow("included_genres", {
              title: "Include Genres",
              value: this.includedGenres,
              options: this.genres,
              minItemCount: 0,
              maxItemCount: this.genres.length,
              onValueChange: Application.Selector<
                MangaKSearchForm,
                (value: string[]) => Promise<void>
              >(this, "updateIncludedGenres"),
            }),
            SelectRow("excluded_genres", {
              title: "Exclude Genres",
              value: this.excludedGenres,
              options: this.genres,
              minItemCount: 0,
              maxItemCount: this.genres.length,
              onValueChange: Application.Selector<
                MangaKSearchForm,
                (value: string[]) => Promise<void>
              >(this, "updateExcludedGenres"),
            }),
          ],
        ),
      );
    }

    return sections;
  }
}
