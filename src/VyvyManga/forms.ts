import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type JSONObject,
} from "@paperback/types";

export interface VyvyMangaSearchMeta extends JSONObject {
  searchType: string[];
  authorSearchType: string[];
  status: string[];
  sort: string[];
  sortType: string[];
  searchDescription: string[];
  author: string;
  includeGenres: string[];
  excludeGenres: string[];
}

export const SEARCH_TYPE_OPTIONS = [
  { id: "0", title: "Contain" },
  { id: "1", title: "Begin" },
  { id: "2", title: "End" },
];

export const AUTHOR_SEARCH_TYPE_OPTIONS = [
  { id: "0", title: "Contain" },
  { id: "1", title: "Begin" },
  { id: "2", title: "End" },
];

export const STATUS_OPTIONS = [
  { id: "2", title: "All" },
  { id: "0", title: "Ongoing" },
  { id: "1", title: "Completed" },
];

export const SORT_OPTIONS = [
  { id: "viewed", title: "Viewed" },
  { id: "scored", title: "Scored" },
  { id: "created_at", title: "Newest" },
  { id: "updated_at", title: "Latest Update" },
];

export const SORT_TYPE_OPTIONS = [
  { id: "desc", title: "Descending" },
  { id: "asc", title: "Ascending" },
];

export const SEARCH_DESCRIPTION_OPTIONS = [
  { id: "", title: "No" },
  { id: "1", title: "Yes" },
];

export const GENRE_OPTIONS = [
  { id: "3D-192-3d", title: "3D" },
  { id: "4-koma-89-4_koma", title: "4-koma" },
  { id: "Academy-237-academy", title: "Academy" },
  { id: "Acting-203-acting", title: "Acting" },
  { id: "Action-1-action", title: "Action" },
  { id: "Adapt-199-adapt", title: "Adapt" },
  { id: "Adaptation-72-adaptation", title: "Adaptation" },
  { id: "Adaption-208-adaption", title: "Adaption" },
  { id: "Adventure-2-adventure", title: "Adventure" },
  { id: "Adventure\n&#039;-226-adventure", title: "Adventure\n'" },
  { id: "Age Gap-165-age_gap", title: "Age Gap" },
  { id: "AI-257-ai", title: "AI" },
  { id: "All Ages-122-all_ages", title: "All Ages" },
  { id: "and slice-of-life-259-and_sliceoflife", title: "and slice-of-life" },
  { id: "Animals-90-animals", title: "Animals" },
  { id: "Anime-152-anime", title: "Anime" },
  { id: "Anthology-101-anthology", title: "Anthology" },
  { id: "anti-hero-253-antihero", title: "anti-hero" },
  { id: "Apocalypse-248-apocalypse", title: "Apocalypse" },
  { id: "Archery-214-archery", title: "Archery" },
  { id: "art-246-art", title: "art" },
  { id: "Artbook-201-artbook", title: "Artbook" },
  { id: "Award winning-91-award_winning", title: "Award winning" },
  { id: "Bara-116-bara", title: "Bara" },
  { id: "Bara(ML)-173-baraml", title: "Bara(ML)" },
  { id: "Bara/ Muscle-188-bara_muscle", title: "Bara/ Muscle" },
  { id: "Battle-252-battle", title: "Battle" },
  { id: "Beasts-175-beasts", title: "Beasts" },
  { id: "Bengali-138-bengali", title: "Bengali" },
  { id: "BL-202-bl", title: "BL" },
  { id: "Blood-267-blood", title: "Blood" },
  { id: "Bloody-183-bloody", title: "Bloody" },
  { id: "Boys-185-boys", title: "Boys" },
  { id: "Boys Love-213-boys_love", title: "Boys Love" },
  { id: "Bully-230-bully", title: "Bully" },
  { id: "business-231-business", title: "business" },
  { id: "Cars-49-cars", title: "Cars" },
  { id: "Cartoon-223-cartoon", title: "Cartoon" },
  { id: "Cheat system-264-cheat_system", title: "Cheat system" },
  { id: "Cheating/Infidelity-176-cheatinginfidelity", title: "Cheating/Infidelity" },
  { id: "Childhood Friends-164-childhood_friends", title: "Childhood Friends" },
  { id: "College life-157-college_life", title: "College life" },
  { id: "Comedy-15-comedy", title: "Comedy" },
  { id: "Comic-130-comic", title: "Comic" },
  { id: "Cooking-63-cooking", title: "Cooking" },
  { id: "Crazy MC-241-crazy_mc", title: "Crazy MC" },
  { id: "Crime-81-crime", title: "Crime" },
  { id: "Crossdressing-105-crossdressing", title: "Crossdressing" },
  { id: "Cultivation-229-cultivation", title: "Cultivation" },
  { id: "Delinquents-73-delinquents", title: "Delinquents" },
  { id: "Dementia-48-dementia", title: "Dementia" },
  { id: "Demon-205-demon", title: "Demon" },
  { id: "Demons-3-demons", title: "Demons" },
  { id: "Dom/Sub verse-193-domsub_verse", title: "Dom/Sub verse" },
  { id: "Doujinshi-55-doujinshi", title: "Doujinshi" },
  { id: "Drama-4-drama", title: "Drama" },
  { id: "Drama Seinen-269-drama_seinen", title: "Drama Seinen" },
  { id: "Dungeons-171-dungeons", title: "Dungeons" },
  { id: "Ecchi-27-ecchi", title: "Ecchi" },
  { id: "Employee-265-employee", title: "Employee" },
  { id: "Erotica-146-erotica", title: "Erotica" },
  { id: "Evolution-219-evolution", title: "Evolution" },
  { id: "Fantasy-7-fantasy", title: "Fantasy" },
  { id: "Fantasy Harem-234-fantasy_harem", title: "Fantasy Harem" },
  { id: "fantasy، Martial arts-260-fantasy_martial_arts", title: "fantasy، Martial arts" },
  { id: "Fantasy.Manhwa-215-fantasymanhwa", title: "Fantasy.Manhwa" },
  { id: "Fetish-180-fetish", title: "Fetish" },
  { id: "Fight-220-fight", title: "Fight" },
  { id: "Fighting-268-fighting", title: "Fighting" },
  { id: "Full color-82-full_color", title: "Full color" },
  { id: "Full Colored-78-official_colored", title: "Full Colored" },
  { id: "Furry-190-furry", title: "Furry" },
  { id: "Game-33-game", title: "Game" },
  { id: "Gangster-204-gangster", title: "Gangster" },
  { id: "Gender Bender-39-gender_bender", title: "Gender Bender" },
  { id: "gender-bender-271-genderbender", title: "gender-bender" },
  { id: "Genderswap-159-genderswap", title: "Genderswap" },
  { id: "Genius MC-217-genius_mc", title: "Genius MC" },
  { id: "Ghosts-97-ghosts", title: "Ghosts" },
  { id: "Girls-184-girls", title: "Girls" },
  { id: "Girls Love-254-girls_love", title: "Girls Love" },
  { id: "Gore-200-gore", title: "Gore" },
  { id: "Gossip-123-gossip", title: "Gossip" },
  { id: "Gyaru-104-gyaru", title: "Gyaru" },
  { id: "Harem-38-harem", title: "Harem" },
  { id: "Harlequin-178-harlequin", title: "Harlequin" },
  { id: "Historical-12-historical", title: "Historical" },
  { id: "Horror-5-horror", title: "Horror" },
  { id: "Hunter-244-hunter", title: "Hunter" },
  { id: "Hunters-221-hunters", title: "Hunters" },
  { id: "Idol-245-idol", title: "Idol" },
  { id: "Idols-238-idols", title: "Idols" },
  { id: "Incest-98-incest", title: "Incest" },
  { id: "Indonesian-137-indonesian", title: "Indonesian" },
  { id: "Isekai-69-isekai", title: "Isekai" },
  { id: "Italian-136-italian", title: "Italian" },
  { id: "Japanese-129-japanese", title: "Japanese" },
  { id: "Josei-35-josei", title: "Josei" },
  { id: "Josei(W)-166-joseiw", title: "Josei(W)" },
  { id: "Kids-42-kids", title: "Kids" },
  { id: "ladies-211-ladies", title: "ladies" },
  { id: "Loli-225-loli", title: "Loli" },
  { id: "Long strip-76-long_strip", title: "Long strip" },
  { id: "Mafia-83-mafia", title: "Mafia" },
  { id: "Magic-34-magic", title: "Magic" },
  { id: "Magical-194-magical", title: "Magical" },
  { id: "Magical girls-88-magical_girls", title: "Magical girls" },
  { id: "Mahou Shoujo-266-mahou_shoujo", title: "Mahou Shoujo" },
  { id: "Mahua-216-mahua", title: "Mahua" },
  { id: "Man-224-man", title: "Man" },
  { id: "Manga-127-manga", title: "Manga" },
  { id: "Manga Adaptation-249-manga_adaptation", title: "Manga Adaptation" },
  { id: "mangatoon-206-mangatoon", title: "mangatoon" },
  { id: "Manha-262-manha", title: "Manha" },
  { id: "Manhua-62-manhua", title: "Manhua" },
  { id: "Manhwa-61-manhwa", title: "Manhwa" },
  { id: "Manhwa Hot-240-manhwa_hot", title: "Manhwa Hot" },
  { id: "mannhw-270-mannhw", title: "mannhw" },
  { id: "manwha-228-manwha", title: "manwha" },
  { id: "Martial Arts-37-martial_arts", title: "Martial Arts" },
  { id: "Mature-60-mature", title: "Mature" },
  { id: "Mecha-36-mecha", title: "Mecha" },
  { id: "Medical-66-medical", title: "Medical" },
  { id: "Medicaldrama-210-medicaldrama", title: "Medicaldrama" },
  { id: "Military-8-military", title: "Military" },
  { id: "Monster girls-95-monster_girls", title: "Monster girls" },
  { id: "Monsters-84-monsters", title: "Monsters" },
  { id: "MONSTERS\nACTION-251-monstersaction", title: "MONSTERS\nACTION" },
  { id: "Murim-195-murim", title: "Murim" },
  { id: "Music-32-music", title: "Music" },
  { id: "Mystery-11-mystery", title: "Mystery" },
  { id: "Netorare/NTR-158-netorarentr", title: "Netorare/NTR" },
  { id: "Ninja-93-ninja", title: "Ninja" },
  { id: "Non-human-186-nonhuman", title: "Non-human" },
  { id: "NOVEL-56-novel", title: "NOVEL" },
  { id: "OEL-131-english", title: "OEL" },
  { id: "Office-126-office", title: "Office" },
  { id: "Official Colored-227-official_colored", title: "Official Colored" },
  { id: "Omegaverse-154-omegaverse", title: "Omegaverse" },
  { id: "One Shot-67-one_shot", title: "One Shot" },
  { id: "Others-232-others", title: "Others" },
  { id: "Otome-255-otome", title: "Otome" },
  { id: "Overpowered-242-overpowered", title: "Overpowered" },
  { id: "Parody-30-parody", title: "Parody" },
  { id: "Pets-247-pets", title: "Pets" },
  { id: "Philosophical-100-philosophical", title: "Philosophical" },
  { id: "Police-46-police", title: "Police" },
  { id: "political-250-political", title: "political" },
  { id: "Pornographic-147-pornographic", title: "Pornographic" },
  { id: "Post apocalyptic-94-post_apocalyptic", title: "Post apocalyptic" },
  { id: "Post-Apocalyptic-140-postapocalyptic", title: "Post-Apocalyptic" },
  { id: "Psychological-9-psychological", title: "Psychological" },
  { id: "Psychology-258-psychology", title: "Psychology" },
  { id: "R-18-212-r18", title: "R-18" },
  { id: "Rebirth-196-rebirth", title: "Rebirth" },
  { id: "Regression-170-regression", title: "Regression" },
  { id: "Reincarnation-74-reincarnation", title: "Reincarnation" },
  { id: "Returnee-243-returnee", title: "Returnee" },
  { id: "Revenge-182-revenge", title: "Revenge" },
  { id: "Reverse-198-reverse", title: "Reverse" },
  { id: "Reverse harem-79-reverse_harem", title: "Reverse harem" },
  { id: "Romance-25-romance", title: "Romance" },
  { id: "Royal family-155-royal_family", title: "Royal family" },
  { id: "Royalty-174-royalty", title: "Royalty" },
  { id: "Russian-139-russian", title: "Russian" },
  { id: "Samurai-18-samurai", title: "Samurai" },
  { id: "School-189-school", title: "School" },
  { id: "school action-261-school_action", title: "school action" },
  { id: "School life-59-school_life", title: "School life" },
  { id: "Sci-fi-148-scifi", title: "Sci-fi" },
  { id: "Sci-fi  Shounen-236-scifi_shounen", title: "Sci-fi  Shounen" },
  { id: "Seinen-10-seinen", title: "Seinen" },
  { id: "Seinen(M)-167-seinenm", title: "Seinen(M)" },
  { id: "Sexual violence-117-sexual_violence", title: "Sexual violence" },
  { id: "Shotacon-160-shotacon", title: "Shotacon" },
  { id: "Shoujo-28-shoujo", title: "Shoujo" },
  { id: "Shoujo Ai-40-shoujo_ai", title: "Shoujo Ai" },
  { id: "Shounen-13-shounen", title: "Shounen" },
  { id: "Shounen\nType-222-shounentype", title: "Shounen\nType" },
  { id: "Shounen Ai-44-shounen_ai", title: "Shounen Ai" },
  { id: "Shounen(B)-168-shounenb", title: "Shounen(B)" },
  { id: "Showbiz-177-showbiz", title: "Showbiz" },
  { id: "Si-fi-142-sifi", title: "Si-fi" },
  { id: "Silver &amp; Golden-187-silver_golden", title: "Silver & Golden" },
  { id: "Slice of Life-19-slice_of_life", title: "Slice of Life" },
  { id: "SM/BDSM/SUB-DOM-181-smbdsmsubdom", title: "SM/BDSM/SUB-DOM" },
  { id: "Smut-65-smut", title: "Smut" },
  { id: "Space-29-space", title: "Space" },
  { id: "Sports-22-sports", title: "Sports" },
  { id: "SUGGESTIVE-207-suggestive", title: "SUGGESTIVE" },
  { id: "Super Power-17-super_power", title: "Super Power" },
  { id: "Superhero-109-superhero", title: "Superhero" },
  { id: "Supernatural-6-supernatural", title: "Supernatural" },
  { id: "Survival-85-survival", title: "Survival" },
  { id: "Suspense-256-suspense", title: "Suspense" },
  { id: "SWORDS-149-swords", title: "SWORDS" },
  { id: "System-197-system", title: "System" },
  { id: "Thriller-31-thriller", title: "Thriller" },
  { id: "Time travel-80-time_travel", title: "Time travel" },
  { id: "Toomics-120-toomics", title: "Toomics" },
  { id: "Tower-239-tower", title: "Tower" },
  { id: "Traditional games-113-traditional_games", title: "Traditional games" },
  { id: "Tragedy-68-tragedy", title: "Tragedy" },
  { id: "Transmigration-179-transmigration", title: "Transmigration" },
  { id: "Uncategorized-50-uncategorized", title: "Uncategorized" },
  { id: "Uncensored-124-uncensored", title: "Uncensored" },
  { id: "User created-102-user_created", title: "User created" },
  { id: "Vampire-151-vampire", title: "Vampire" },
  { id: "Vampires-103-vampires", title: "Vampires" },
  { id: "Vanilla-125-vanilla", title: "Vanilla" },
  { id: "Video games-75-video_games", title: "Video games" },
  { id: "Villainess-119-villainess", title: "Villainess" },
  { id: "Violence-169-violence", title: "Violence" },
  { id: "Virtual reality-110-virtual_reality", title: "Virtual reality" },
  { id: "Webtoons-141-webtoons", title: "Webtoons" },
  { id: "Western-172-western", title: "Western" },
  { id: "Work-Life-263-worklife", title: "Work-Life" },
  { id: "Wuxia-106-wuxia", title: "Wuxia" },
  { id: "Xianxia-233-xianxia", title: "Xianxia" },
  { id: "Yakuzas-156-yakuzas", title: "Yakuzas" },
  { id: "Yaoi-51-yaoi", title: "Yaoi" },
  { id: "Yuri-54-yuri", title: "Yuri" },
  { id: "Zh-hk-135-zhhk", title: "Zh-hk" },
  { id: "Zombies-108-zombies", title: "Zombies" },
];

export class VyvyMangaSearchForm extends AdvancedSearchForm {
  private searchType: string[];
  private authorSearchType: string[];
  private status: string[];
  private sort: string[];
  private sortType: string[];
  private searchDescription: string[];
  private author: string;
  private includeGenres: string[];
  private excludeGenres: string[];

  constructor(initialMeta?: VyvyMangaSearchMeta) {
    super();
    this.searchType = initialMeta?.searchType ?? [];
    this.authorSearchType = initialMeta?.authorSearchType ?? [];
    this.status = initialMeta?.status ?? [];
    this.sort = initialMeta?.sort ?? [];
    this.sortType = initialMeta?.sortType ?? [];
    this.searchDescription = initialMeta?.searchDescription ?? [];
    this.author = initialMeta?.author ?? "";
    this.includeGenres = initialMeta?.includeGenres ?? [];
    this.excludeGenres = initialMeta?.excludeGenres ?? [];
  }

  async updateSearchType(value: string[]): Promise<void> {
    this.searchType = value;
    this.reloadForm();
  }

  async updateAuthorSearchType(value: string[]): Promise<void> {
    this.authorSearchType = value;
    this.reloadForm();
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value;
    this.reloadForm();
  }

  async updateSort(value: string[]): Promise<void> {
    this.sort = value;
    this.reloadForm();
  }

  async updateSortType(value: string[]): Promise<void> {
    this.sortType = value;
    this.reloadForm();
  }

  async updateSearchDescription(value: string[]): Promise<void> {
    this.searchDescription = value;
    this.reloadForm();
  }

  async updateAuthor(value: string): Promise<void> {
    this.author = value;
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

  getSearchQueryMetadata(): JSONObject {
    return {
      searchMeta: {
        searchType: this.searchType,
        authorSearchType: this.authorSearchType,
        status: this.status,
        sort: this.sort,
        sortType: this.sortType,
        searchDescription: this.searchDescription,
        author: this.author,
        includeGenres: this.includeGenres,
        excludeGenres: this.excludeGenres,
      } satisfies VyvyMangaSearchMeta,
    };
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("search_type", {
          title: "Title Search Mode",
          value: this.searchType,
          options: SEARCH_TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
            "updateSearchType",
          ),
        }),
        SelectRow("search_description", {
          title: "Search In Description",
          value: this.searchDescription,
          options: SEARCH_DESCRIPTION_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
            "updateSearchDescription",
          ),
        }),
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
            "updateAuthor",
          ),
        }),
        SelectRow("author_search_type", {
          title: "Author Search Mode",
          value: this.authorSearchType,
          options: AUTHOR_SEARCH_TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
            "updateAuthorSearchType",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.status,
          options: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
            "updateStatus",
          ),
        }),
        SelectRow("sort", {
          title: "Sort By",
          value: this.sort,
          options: SORT_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
            "updateSort",
          ),
        }),
        SelectRow("sort_type", {
          title: "Sort Direction",
          value: this.sortType,
          options: SORT_TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
            "updateSortType",
          ),
        }),
        SelectRow("include_genres", {
          title: "Include Genres",
          value: this.includeGenres,
          options: GENRE_OPTIONS,
          minItemCount: 0,
          maxItemCount: GENRE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as VyvyMangaSearchForm,
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
            this as VyvyMangaSearchForm,
            "updateExcludeGenres",
          ),
        }),
      ]),
    ];
  }
}
