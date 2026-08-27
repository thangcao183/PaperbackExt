import { AdvancedSearchForm, Section, SelectRow, } from "@paperback/types";
const STATUS_OPTIONS = [
    { id: "", title: "All" },
    { id: "ongoing", title: "Ongoing" },
    { id: "completed", title: "Completed" },
    { id: "hiatus", title: "Hiatus" },
];
const GENRE_OPTIONS = [
    { id: "action", title: "Action" },
    { id: "adaptation", title: "Adaptation" },
    { id: "adult", title: "Adult" },
    { id: "adventure", title: "Adventure" },
    { id: "comedy", title: "Comedy" },
    { id: "demons", title: "Demons" },
    { id: "drama", title: "Drama" },
    { id: "ecchi", title: "Ecchi" },
    { id: "fantasy", title: "Fantasy" },
    { id: "gender-bender", title: "Gender Bender" },
    { id: "gore", title: "Gore" },
    { id: "harem", title: "Harem" },
    { id: "historical", title: "Historical" },
    { id: "horror", title: "Horror" },
    { id: "isekai", title: "Isekai" },
    { id: "josei", title: "Josei" },
    { id: "magic", title: "Magic" },
    { id: "martial-arts", title: "Martial Arts" },
    { id: "mature", title: "Mature" },
    { id: "mecha", title: "Mecha" },
    { id: "military", title: "Military" },
    { id: "monsters", title: "Monsters" },
    { id: "mystery", title: "Mystery" },
    { id: "post-apocalyptic", title: "Post-Apocalyptic" },
    { id: "psychological", title: "Psychological" },
    { id: "romance", title: "Romance" },
    { id: "school-life", title: "School Life" },
    { id: "sci-fi", title: "Sci-Fi" },
    { id: "seinen", title: "Seinen" },
    { id: "shoujo", title: "Shoujo" },
    { id: "shoujo-ai", title: "Shoujo Ai" },
    { id: "shounen", title: "Shounen" },
    { id: "shounen-ai", title: "Shounen Ai" },
    { id: "slice-of-life", title: "Slice of Life" },
    { id: "smut", title: "Smut" },
    { id: "sports", title: "Sports" },
    { id: "supernatural", title: "Supernatural" },
    { id: "thriller", title: "Thriller" },
    { id: "tragedy", title: "Tragedy" },
    { id: "video-games", title: "Video Games" },
    { id: "webtoons", title: "Webtoons" },
    { id: "wuxia", title: "Wuxia" },
    { id: "yaoi", title: "Yaoi" },
    { id: "yuri", title: "Yuri" },
];
export class StoneScapeSearchForm extends AdvancedSearchForm {
    status;
    genres;
    constructor(initialMeta) {
        super();
        this.status = initialMeta?.status ?? [];
        this.genres = initialMeta?.genres ?? [];
    }
    async updateStatus(value) {
        this.status = value;
        this.reloadForm();
    }
    async updateGenres(value) {
        this.genres = value;
        this.reloadForm();
    }
    getSearchQueryMetadata() {
        return {
            searchMeta: {
                status: this.status,
                genres: this.genres,
            },
        };
    }
    getSections() {
        return [
            Section("filters", [
                SelectRow("status", {
                    title: "Status",
                    value: this.status,
                    options: STATUS_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(this, "updateStatus"),
                }),
                SelectRow("genres", {
                    title: "Genres",
                    value: this.genres,
                    options: GENRE_OPTIONS,
                    minItemCount: 0,
                    maxItemCount: GENRE_OPTIONS.length,
                    onValueChange: Application.Selector(this, "updateGenres"),
                }),
            ]),
        ];
    }
}
