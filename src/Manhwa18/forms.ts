import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface Manhwa18SearchMeta extends JSONObject {
  sort: string[];
  status: string[];
  genres: string[];
}

export const SORT_OPTIONS = [
  { id: "update", title: "Latest update" },
  { id: "new", title: "New manhwa" },
  { id: "top", title: "Most view" },
  { id: "like", title: "Most like" },
  { id: "az", title: "A - Z" },
  { id: "za", title: "Z - A" },
];

export const STATUS_OPTIONS = [
  { id: "0", title: "All" },
  { id: "1", title: "Ongoing" },
  { id: "2", title: "On hold" },
  { id: "3", title: "Completed" },
];

export const GENRE_OPTIONS = [
  { id: "4", title: "Adult" },
  { id: "9", title: "Doujinshi" },
  { id: "17", title: "Harem" },
  { id: "24", title: "Manga" },
  { id: "26", title: "Manhwa" },
  { id: "28", title: "Mature" },
  { id: "33", title: "NTR" },
  { id: "36", title: "Romance" },
  { id: "57", title: "Webtoon" },
  { id: "59", title: "Action" },
  { id: "60", title: "Comedy" },
  { id: "61", title: "BL" },
  { id: "62", title: "Horror" },
  { id: "63", title: "Raw" },
  { id: "64", title: "Uncensore" },
  { id: "65", title: "Art" },
  { id: "66", title: "M18Scan" },
  { id: "68", title: "Drama" },
  { id: "128", title: "Supernatural" },
  { id: "160", title: "Seinen" },
  { id: "161", title: "Borderline H" },
  { id: "162", title: "Full Color" },
  { id: "163", title: "Slice of Life" },
  { id: "164", title: "Smut" },
  { id: "165", title: "Uncensored" },
  { id: "166", title: "Webtoons" },
  { id: "167", title: "Explicit Sex" },
  { id: "168", title: "Cohabitation" },
  { id: "169", title: "Delinquents" },
  { id: "170", title: "Fetish" },
  { id: "171", title: "Nudity" },
  { id: "172", title: "Sexual Abuse" },
  { id: "173", title: "Sexual Content" },
  { id: "174", title: "Fantasy" },
  { id: "175", title: "Ghosts" },
  { id: "176", title: "Historical" },
  { id: "177", title: "School Life" },
  { id: "178", title: "Psychological" },
  { id: "179", title: "Incest" },
  { id: "180", title: "Japanese Webtoons" },
  { id: "181", title: "Coworkers" },
  { id: "182", title: "Salaryman" },
  { id: "183", title: "Siblings" },
  { id: "184", title: "Work Life" },
  { id: "185", title: "Gyaru" },
  { id: "186", title: "Based on Another Work" },
  { id: "187", title: "Demons" },
  { id: "188", title: "Crime" },
  { id: "189", title: "Mystery" },
  { id: "190", title: "Reverse Harem" },
  { id: "191", title: "Adventure" },
  { id: "192", title: "Isekai" },
  { id: "193", title: "Magic" },
  { id: "194", title: "Thriller" },
  { id: "195", title: "Time Travel" },
  { id: "196", title: "Reincarnation" },
  { id: "197", title: "Sports" },
  { id: "198", title: "Medical" },
  { id: "199", title: "Sci Fi" },
  { id: "200", title: "AI Art" },
  { id: "201", title: "Animal Characteristics" },
  { id: "202", title: "Monster Girls" },
  { id: "203", title: "Violence" },
  { id: "204", title: "Collection of Stories" },
  { id: "205", title: "Ecchi" },
  { id: "206", title: "Monsters" },
  { id: "207", title: "Survival" },
];

export class Manhwa18SearchForm extends AdvancedSearchForm {
  private sort: string[];
  private status: string[];
  private genres: string[];

  constructor(initialMeta?: Manhwa18SearchMeta) {
    super();
    this.sort = initialMeta?.sort ?? [];
    this.status = initialMeta?.status ?? [];
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

  async updateGenres(value: string[]): Promise<void> {
    this.genres = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        sort: this.sort,
        status: this.status,
        genres: this.genres,
      } satisfies Manhwa18SearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("sort", {
          title: "Order",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as Manhwa18SearchForm,
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
            this as Manhwa18SearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("genres", {
          title: "Genres",
          value: this.genres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as Manhwa18SearchForm,
            "updateGenres",
          ),
        }),
      ]),
    ];
  }
}
