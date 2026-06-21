import { ButtonRow, Form, Section, ToggleRow } from "@paperback/types";

const HIDE_LOCKED_KEY = "mangamirai.hideLocked";

export function getHideLocked(): boolean {
  const v = Application.getState(HIDE_LOCKED_KEY);
  return typeof v === "boolean" ? v : false;
}

function setHideLocked(value: boolean): void {
  Application.setState(value, HIDE_LOCKED_KEY);
}

export class MangaMiraiSettingsForm extends Form {
  private hideLocked: boolean;

  constructor() {
    super();
    this.hideLocked = getHideLocked();
  }

  async updateHideLocked(value: boolean): Promise<void> {
    this.hideLocked = value;
    setHideLocked(value);
    this.reloadForm();
  }

  async resetHideLocked(): Promise<void> {
    this.hideLocked = false;
    setHideLocked(false);
    this.reloadForm();
  }

  override getSections() {
    return [
      Section(
        { id: "chapters", footer: "Hide locked/preview chapters that require purchase or login." },
        [
          ToggleRow("hide_locked", {
            title: "Hide locked chapters",
            value: this.hideLocked,
            onValueChange: Application.Selector(
              this as MangaMiraiSettingsForm,
              "updateHideLocked",
            ),
          }),
          ButtonRow("hide_locked_reset", {
            title: "Reset",
            onSelect: Application.Selector(
              this as MangaMiraiSettingsForm,
              "resetHideLocked",
            ),
          }),
        ],
      ),
    ];
  }
}
