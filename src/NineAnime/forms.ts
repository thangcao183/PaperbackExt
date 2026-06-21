import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface NineAnimeSearchMeta extends JSONObject {
  genre: string[];
}

// Pairs of [display title, uriPart] from keiyoushi Filters.kt GenreFilter.
export const GENRE_OPTIONS: { id: string; title: string }[] = [
  { id: "All", title: "All" },
  { id: "4-Koma", title: "4-Koma" },
  { id: "Action", title: "Action" },
  { id: "Adaptation", title: "Adaptation" },
  { id: "Adult", title: "Adult" },
  { id: "Adventure", title: "Adventure" },
  { id: "Aliens", title: "Aliens" },
  { id: "category", title: "All (category)" },
  { id: "Animals", title: "Animals" },
  { id: "Anthology", title: "Anthology" },
  { id: "Award+Winning", title: "Award Winning" },
  { id: "Comedy", title: "Comedy" },
  { id: "Cooking", title: "Cooking" },
  { id: "Crime", title: "Crime" },
  { id: "Crossdressing", title: "Crossdressing" },
  { id: "Delinquents", title: "Delinquents" },
  { id: "Demons", title: "Demons" },
  { id: "Doujinshi", title: "Doujinshi" },
  { id: "Drama", title: "Drama" },
  { id: "Ecchi", title: "Ecchi" },
  { id: "Fantasy", title: "Fantasy" },
  { id: "Food", title: "Food" },
  { id: "Full+color", title: "Full Color" },
  { id: "Game", title: "Game" },
  { id: "Gender+Bender", title: "Gender Bender" },
  { id: "Genderswap", title: "Genderswap" },
  { id: "Ghosts", title: "Ghosts" },
  { id: "Gossip", title: "Gossip" },
  { id: "Gyaru", title: "Gyaru" },
  { id: "Harem", title: "Harem" },
  { id: "Hentai", title: "Hentai" },
  { id: "Historical", title: "Historical" },
  { id: "Horror", title: "Horror" },
  { id: "Incest", title: "Incest" },
  { id: "Isekai", title: "Isekai" },
  { id: "Josei", title: "Josei" },
  { id: "Kids", title: "Kids" },
  { id: "Loli", title: "Loli" },
  { id: "Long+strip", title: "Long Strip" },
  { id: "Mafia", title: "Mafia" },
  { id: "Magic", title: "Magic" },
  { id: "Magical+Girls", title: "Magical Girls" },
  { id: "Manga", title: "Manga" },
  { id: "Manhua", title: "Manhua" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Martial+Arts", title: "Martial Arts" },
  { id: "Mature", title: "Mature" },
  { id: "Mecha", title: "Mecha" },
  { id: "Medical", title: "Medical" },
  { id: "Military", title: "Military" },
  { id: "Monster+girls", title: "Monster Girls" },
  { id: "Monsters", title: "Monsters" },
  { id: "Music", title: "Music" },
  { id: "Mystery", title: "Mystery" },
  { id: "N%2Fa", title: "N/A" },
  { id: "Ninja", title: "Ninja" },
  { id: "None", title: "None" },
  { id: "Office+workers", title: "Office Workers" },
  { id: "Official+colored", title: "Official Colored" },
  { id: "One+Shot", title: "One Shot" },
  { id: "Oneshot", title: "Oneshot" },
  { id: "Parody", title: "Parody" },
  { id: "Philosophical", title: "Philosophical" },
  { id: "Police", title: "Police" },
  { id: "Post+apocalyptic", title: "Post Apocalyptic" },
  { id: "Psychological", title: "Psychological" },
  { id: "Reincarnation", title: "Reincarnation" },
  { id: "Reverse+harem", title: "Reverse Harem" },
  { id: "Romance", title: "Romance" },
  { id: "Samurai", title: "Samurai" },
  { id: "School+Life", title: "School Life" },
  { id: "sci+fi", title: "Sci Fi" },
  { id: "Sci-fi", title: "Sci-Fi" },
  { id: "Seinen", title: "Seinen" },
  { id: "Shota", title: "Shota" },
  { id: "Shotacon", title: "Shotacon" },
  { id: "Shoujo", title: "Shoujo" },
  { id: "Shoujo+Ai", title: "Shoujo Ai" },
  { id: "Shounen", title: "Shounen" },
  { id: "Shounen+Ai", title: "Shounen Ai" },
  { id: "Slice+Of+Life", title: "Slice Of Life" },
  { id: "Smut", title: "Smut" },
  { id: "Sports", title: "Sports" },
  { id: "Super+power", title: "Super Power" },
  { id: "Superhero", title: "Superhero" },
  { id: "Supernatural", title: "Supernatural" },
  { id: "Survival", title: "Survival" },
  { id: "Thriller", title: "Thriller" },
  { id: "Time+travel", title: "Time Travel" },
  { id: "Toomics", title: "Toomics" },
  { id: "Tragedy", title: "Tragedy" },
  { id: "Uncategorized", title: "Uncategorized" },
  { id: "User+created", title: "User Created" },
  { id: "Vampire", title: "Vampire" },
  { id: "Vampires", title: "Vampires" },
  { id: "Video+games", title: "Video Games" },
  { id: "Virtual+reality", title: "Virtual Reality" },
  { id: "Web+comic", title: "Web Comic" },
  { id: "Webtoon", title: "Webtoon" },
  { id: "Webtoons", title: "Webtoons" },
  { id: "Wuxia", title: "Wuxia" },
  { id: "Yaoi", title: "Yaoi" },
  { id: "Yuri", title: "Yuri" },
  { id: "Zombies", title: "Zombies" },
  { id: "%5Bno+chapters%5D", title: "[No Chapters]" },
];

export class NineAnimeSearchForm extends AdvancedSearchForm {
  private genre: string[];

  constructor(initialMeta?: NineAnimeSearchMeta) {
    super();
    this.genre = initialMeta?.genre ?? [];
  }

  async updateGenre(value: string[]): Promise<void> {
    this.genre = value;
    this.reloadForm();
  }

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        genre: this.genre,
      } satisfies NineAnimeSearchMeta,
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
            this as NineAnimeSearchForm,
            "updateGenre",
          ),
        }),
      ]),
    ];
  }
}
