import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
const GENRE_OPTIONS = [
    { id: "manga-genre-action", title: "Action" },
    { id: "manga-genre-adaptation", title: "Adaptation" },
    { id: "manga-genre-adult", title: "Adult" },
    { id: "manga-genre-adventure", title: "Adventure" },
    { id: "manga-genre-boy-love", title: "Boy love" },
    { id: "manga-genre-comedy", title: "Comedy" },
    { id: "manga-genre-comic", title: "Comic" },
    { id: "manga-genre-cooking", title: "Cooking" },
    { id: "manga-genre-crime", title: "Crime" },
    { id: "manga-genre-doujinshi", title: "Doujinshi" },
    { id: "manga-genre-drama", title: "Drama" },
    { id: "manga-genre-ecchi", title: "Ecchi" },
    { id: "manga-genre-fantasy", title: "Fantasy" },
    { id: "manga-genre-full-color", title: "Full Color" },
    { id: "manga-genre-game", title: "Game" },
    { id: "manga-genre-gender-bender", title: "Gender Bender" },
    { id: "manga-genre-harem", title: "Harem" },
    { id: "manga-genre-historical", title: "Historical" },
    { id: "manga-genre-horror", title: "Horror" },
    { id: "manga-genre-isekai", title: "Isekai" },
    { id: "manga-genre-josei", title: "Josei" },
    { id: "manga-genre-magic", title: "Magic" },
    { id: "manga-genre-manga", title: "Manga" },
    { id: "manga-genre-manhua", title: "Manhua" },
    { id: "manga-genre-manhwa", title: "Manhwa" },
    { id: "manga-genre-martial-arts", title: "Martial Arts" },
    { id: "manga-genre-mature", title: "Mature" },
    { id: "manga-genre-mecha", title: "Mecha" },
    { id: "manga-genre-medical", title: "Medical" },
    { id: "manga-genre-mystery", title: "Mystery" },
    { id: "manga-genre-ntr", title: "NTR" },
    { id: "manga-genre-oneshot", title: "Oneshot" },
    { id: "manga-genre-psychological", title: "Psychological" },
    { id: "manga-genre-reincarnation", title: "Reincarnation" },
    { id: "manga-genre-romance", title: "Romance" },
    { id: "manga-genre-school-life", title: "School life" },
    { id: "manga-genre-sci-fi", title: "Sci-fi" },
    { id: "manga-genre-seinen", title: "Seinen" },
    { id: "manga-genre-shoujo", title: "Shoujo" },
    { id: "manga-genre-shoujo-ai", title: "Shoujo ai" },
    { id: "manga-genre-shounen", title: "Shounen" },
    { id: "manga-genre-shounen-ai", title: "Shounen ai" },
    { id: "manga-genre-slice-of-life", title: "Slice Of Life" },
    { id: "manga-genre-smut", title: "Smut" },
    { id: "manga-genre-soft-yaoi", title: "Soft Yaoi" },
    { id: "manga-genre-soft-yuri", title: "Soft Yuri" },
    { id: "manga-genre-sports", title: "Sports" },
    { id: "manga-genre-super-power", title: "Super Power" },
    { id: "manga-genre-supernatural", title: "Supernatural" },
    { id: "manga-genre-survival", title: "Survival" },
    { id: "manga-genre-time-travel", title: "Time travel" },
    { id: "manga-genre-tragedy", title: "Tragedy" },
    { id: "manga-genre-villainess", title: "Villainess" },
    { id: "manga-genre-webtoon", title: "Webtoon" },
    { id: "manga-genre-webtoons", title: "Webtoons" },
    { id: "manga-genre-yaoi", title: "Yaoi" },
];
export class ManhwalikeSearchForm extends AdvancedSearchForm {
    genre;
    constructor(initialMeta) {
        super();
        this.genre = initialMeta?.genre ?? [];
    }
    async updateGenre(value) {
        this.genre = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                genre: this.genre,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("genre", {
                    title: "Genre (ignored when text search is used)",
                    value: this.genre,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateGenre"),
                }),
            ]),
        ];
    }
}
