import { Form, Section, ToggleRow } from "@paperback/types";
const HIDE_LOCKED_KEY = "alphamanga.hideLocked";
/**
 * Whether locked (rental/purchase-required) chapters should be hidden from the
 * chapter list. Mirrors the upstream `hide_locked` switch preference.
 * Defaults to false (locked chapters are listed, marked with a padlock).
 */
export function getHideLocked() {
    const value = Application.getState(HIDE_LOCKED_KEY);
    return typeof value === "boolean" ? value : false;
}
function setHideLocked(value) {
    Application.setState(value, HIDE_LOCKED_KEY);
}
export class AlphaMangaSettingsForm extends Form {
    hideLocked;
    constructor() {
        super();
        this.hideLocked = getHideLocked();
    }
    async updateHideLocked(value) {
        this.hideLocked = value;
        setHideLocked(value);
        this.reloadForm();
    }
    getSections() {
        return [
            Section({
                id: "chapters",
                footer: "Locked chapters require a rental or purchase on the site and " +
                    "cannot be opened here. They are shown with a 🔒 prefix unless " +
                    "hidden.",
            }, [
                ToggleRow("hide_locked", {
                    title: "Hide locked chapters",
                    value: this.hideLocked,
                    onValueChange: Application.Selector(this, "updateHideLocked"),
                }),
            ]),
        ];
    }
}
