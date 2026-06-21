import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface OppaiStreamSearchMeta extends JSONObject {
  order: string[];
  includeGenres: string[];
  excludeGenres: string[];
}

export const ORDER_OPTIONS: { id: string; title: string }[] = [
  { id: "", title: "Default" },
  { id: "az", title: "A-Z" },
  { id: "za", title: "Z-A" },
  { id: "recent", title: "Recently Released" },
  { id: "old", title: "Oldest Releases" },
  { id: "views", title: "Most Views" },
  { id: "rating", title: "Highest Rated" },
  { id: "uploaded", title: "Recently Uploaded" },
];

export const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "adventure", title: "Adventure" },
  { id: "beach", title: "Beach" },
  { id: "blackmail", title: "Blackmail" },
  { id: "cheating", title: "Cheating" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "drama", title: "Drama" },
  { id: "fantasy", title: "Fantasy" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "incest", title: "Incest" },
  { id: "mindbreak", title: "Mind Break" },
  { id: "mindcontrol", title: "Mind Control" },
  { id: "monster", title: "Monster" },
  { id: "mystery", title: "Mystery" },
  { id: "ntr", title: "NTR" },
  { id: "psychological", title: "Psychological" },
  { id: "rape", title: "Rape" },
  { id: "reverserape", title: "Reverse Rape" },
  { id: "romance", title: "Romance" },
  { id: "schoollife", title: "School Life" },
  { id: "sci-fi", title: "Sci-fi" },
  { id: "secretrelationship", title: "Secret Relationship" },
  { id: "sliceoflife", title: "Slice of Life" },
  { id: "smut", title: "Smut" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "tragedy", title: "Tragedy" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
  { id: "bigboobs", title: "Big Boobs" },
  { id: "blackhair", title: "Black Hair" },
  { id: "blondehair", title: "Blonde Hair" },
  { id: "bluehair", title: "Blue Hair" },
  { id: "brownhair", title: "Brown Hair" },
  { id: "cosplay", title: "Cosplay" },
  { id: "darkskin", title: "Dark Skin" },
  { id: "demon", title: "Demon" },
  { id: "dominantgirl", title: "Dominant Girl" },
  { id: "elf", title: "Elf" },
  { id: "futanari", title: "Futanari" },
  { id: "glasses", title: "Glasses" },
  { id: "greenhair", title: "Green Hair" },
  { id: "gyaru", title: "Gyaru" },
  { id: "invertednipples", title: "Inverted Nipples" },
  { id: "loli", title: "Loli" },
  { id: "maid", title: "Maid" },
  { id: "milf", title: "Milf" },
  { id: "nekomimi", title: "Nekomimi" },
  { id: "nurse", title: "Nurse" },
  { id: "pinkhair", title: "Pink Hair" },
  { id: "pregnant", title: "Pregnant" },
  { id: "purplehair", title: "Purple Hair" },
  { id: "redhair", title: "Red Hair" },
  { id: "schoolgirl", title: "School Girl" },
  { id: "shorthair", title: "Short Hair" },
  { id: "smallboobs", title: "Small Boobs" },
  { id: "succubus", title: "Succubus" },
  { id: "swimsuit", title: "Swimsuit" },
  { id: "teacher", title: "Teacher" },
  { id: "tsundere", title: "Tsundere" },
  { id: "vampire", title: "Vampire" },
  { id: "virgin", title: "Virgin" },
  { id: "whitehair", title: "White Hair" },
  { id: "old", title: "Old" },
  { id: "shota", title: "Shota" },
  { id: "trap", title: "Trap" },
  { id: "uglybastard", title: "Ugly Bastard" },
];

export class OppaiStreamSearchForm extends AdvancedSearchForm {
  private order: string[];
  private includeGenres: string[];
  private excludeGenres: string[];

  constructor(initialMeta?: OppaiStreamSearchMeta) {
    super();
    this.order = initialMeta?.order ?? [];
    this.includeGenres = initialMeta?.includeGenres ?? [];
    this.excludeGenres = initialMeta?.excludeGenres ?? [];
  }

  async updateOrder(value: string[]): Promise<void> {
    this.order = value;
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

  override getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        order: this.order,
        includeGenres: this.includeGenres,
        excludeGenres: this.excludeGenres,
      } satisfies OppaiStreamSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("order", {
          title: "Sort By",
          value: this.order,
          options: ORDER_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as OppaiStreamSearchForm,
            "updateOrder",
          ),
        }),
        SelectRow("include_genres", {
          title: "Include Genres",
          value: this.includeGenres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as OppaiStreamSearchForm,
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
            this as OppaiStreamSearchForm,
            "updateExcludeGenres",
          ),
        }),
      ]),
    ];
  }
}
