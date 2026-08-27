import { Form, LabelRow, Section, SelectRow } from "@paperback/types";
const BLACKLIST_KEY_PREFIX = "mangak.blacklist.";
const GENRE_CACHE_KEY_PREFIX = "mangak.genreCache.";
function blacklistKey(sourceName) {
    return `${BLACKLIST_KEY_PREFIX}${sourceName}`;
}
function genreCacheKey(sourceName) {
    return `${GENRE_CACHE_KEY_PREFIX}${sourceName}`;
}
/**
 * Genre slugs the user always wants excluded from browse and search results.
 * Mirrors the upstream `pref_blacklist` MultiSelectListPreference.
 */
export function getBlacklist(sourceName) {
    const value = Application.getState(blacklistKey(sourceName));
    if (!Array.isArray(value))
        return [];
    return value.filter((v) => typeof v === "string" && v.length > 0);
}
function setBlacklist(sourceName, value) {
    Application.setState(value, blacklistKey(sourceName));
}
/**
 * The genre list is fetched from `/genres` on demand. It is cached in state so
 * the settings form (which cannot perform requests while rendering) can offer
 * the blacklist options after the search filters have been opened once.
 */
export function getCachedGenres(sourceName) {
    const value = Application.getState(genreCacheKey(sourceName));
    if (!Array.isArray(value))
        return [];
    const genres = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object")
            continue;
        const { id, title } = entry;
        if (typeof id === "string" && typeof title === "string" && id.length > 0) {
            genres.push({ id, title });
        }
    }
    return genres;
}
export function setCachedGenres(sourceName, genres) {
    Application.setState(genres.map((g) => ({ id: g.id, title: g.title })), genreCacheKey(sourceName));
}
/**
 * Settings form for a MangaK source. Exposes the global genre blacklist.
 */
export class MangaKSettingsForm extends Form {
    sourceName;
    blacklist;
    genres;
    constructor(sourceName) {
        super();
        this.sourceName = sourceName;
        this.blacklist = getBlacklist(sourceName);
        this.genres = getCachedGenres(sourceName);
    }
    async updateBlacklist(value) {
        this.blacklist = value;
        setBlacklist(this.sourceName, value);
        this.reloadForm();
    }
    getSections() {
        if (this.genres.length === 0) {
            return [
                Section({
                    id: "blacklist",
                    footer: "Open the search filters in the browse screen once to load and " +
                        "sync the genre list, then return here.",
                }, [
                    LabelRow("blacklist_empty", {
                        title: "Global Genre Blacklist",
                        value: "No genres loaded yet",
                    }),
                ]),
            ];
        }
        return [
            Section({
                id: "blacklist",
                footer: "Select genres to always exclude from search and browse results.",
            }, [
                SelectRow("blacklist_select", {
                    title: "Global Genre Blacklist",
                    value: this.blacklist,
                    options: this.genres,
                    minItemCount: 0,
                    maxItemCount: this.genres.length,
                    onValueChange: Application.Selector(this, "updateBlacklist"),
                }),
            ]),
        ];
    }
}
