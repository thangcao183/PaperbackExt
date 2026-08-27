import { ButtonRow, Form, Section, ToggleRow } from "@paperback/types";
const HIDE_LOCKED_KEY = "mangamirai.hideLocked";
export function getHideLocked() {
    const v = Application.getState(HIDE_LOCKED_KEY);
    return typeof v === "boolean" ? v : false;
}
function setHideLocked(value) {
    Application.setState(value, HIDE_LOCKED_KEY);
}
export class MangaMiraiSettingsForm extends Form {
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
    async resetHideLocked() {
        this.hideLocked = false;
        setHideLocked(false);
        this.reloadForm();
    }
    getSections() {
        return [
            Section({ id: "chapters", footer: "Hide locked/preview chapters that require purchase or login." }, [
                ToggleRow("hide_locked", {
                    title: "Hide locked chapters",
                    value: this.hideLocked,
                    onValueChange: Application.Selector(this, "updateHideLocked"),
                }),
                ButtonRow("hide_locked_reset", {
                    title: "Reset",
                    onSelect: Application.Selector(this, "resetHideLocked"),
                }),
            ]),
        ];
    }
}
