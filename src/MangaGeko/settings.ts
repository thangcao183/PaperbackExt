import { Form, Section, ToggleRow } from "@paperback/types";

const HIDE_NSFW_KEY = "mangageko.hideNsfw";

export function getHideNsfw(): boolean {
  const value = Application.getState(HIDE_NSFW_KEY);
  return typeof value === "boolean" ? value : false;
}

function setHideNsfw(value: boolean): void {
  Application.setState(value, HIDE_NSFW_KEY);
}

export class MangaGekoSettingsForm extends Form {
  private hideNsfw: boolean;

  constructor() {
    super();
    this.hideNsfw = getHideNsfw();
  }

  async updateHideNsfw(value: boolean): Promise<void> {
    this.hideNsfw = value;
    setHideNsfw(value);
    this.reloadForm();
  }

  override getSections() {
    return [
      Section({ id: "content", footer: "Hides NSFW entries from browsing." }, [
        ToggleRow("hide_nsfw", {
          title: "Hide NSFW",
          value: this.hideNsfw,
          onValueChange: Application.Selector<
            MangaGekoSettingsForm,
            (value: boolean) => Promise<void>
          >(this, "updateHideNsfw"),
        }),
      ]),
    ];
  }
}
