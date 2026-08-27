import { Form, Section, ToggleRow } from "@paperback/types";
const HIDE_NSFW_KEY = "mangageko.hideNsfw";
export function getHideNsfw() {
    const value = Application.getState(HIDE_NSFW_KEY);
    return typeof value === "boolean" ? value : false;
}
function setHideNsfw(value) {
    Application.setState(value, HIDE_NSFW_KEY);
}
export class MangaGekoSettingsForm extends Form {
    hideNsfw;
    constructor() {
        super();
        this.hideNsfw = getHideNsfw();
    }
    async updateHideNsfw(value) {
        this.hideNsfw = value;
        setHideNsfw(value);
        this.reloadForm();
    }
    getSections() {
        return [
            Section({ id: "content", footer: "Hides NSFW entries from browsing." }, [
                ToggleRow("hide_nsfw", {
                    title: "Hide NSFW",
                    value: this.hideNsfw,
                    onValueChange: Application.Selector(this, "updateHideNsfw"),
                }),
            ]),
        ];
    }
}
