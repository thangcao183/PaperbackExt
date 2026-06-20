import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
} from "@paperback/types";

const BASE_URL_KEY_PREFIX = "mangabox.baseUrlOverride.";

function baseUrlKey(sourceName: string): string {
  return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}

/**
 * Returns the user-configured base URL override for a source, or undefined
 * when none is set. Trailing slashes are stripped.
 */
export function getBaseUrlOverride(sourceName: string): string | undefined {
  const value = Application.getState(baseUrlKey(sourceName));
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function setBaseUrlOverride(sourceName: string, value: string): void {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(trimmed, baseUrlKey(sourceName));
}

/**
 * Settings form for a MangaBox source. Lets the user override the base URL,
 * which is also how mirrors are selected (each mirror is a different domain).
 */
export class MangaBoxSettingsForm extends Form {
  private override: string;

  constructor(
    private readonly sourceName: string,
    private readonly defaultBaseUrl: string,
    private readonly mirrors: string[],
  ) {
    super();
    this.override = getBaseUrlOverride(sourceName) ?? "";
  }

  async updateOverride(value: string): Promise<void> {
    this.override = value;
    setBaseUrlOverride(this.sourceName, value);
    this.reloadForm();
  }

  async resetOverride(): Promise<void> {
    this.override = "";
    setBaseUrlOverride(this.sourceName, "");
    this.reloadForm();
  }

  override getSections() {
    const effective =
      this.override.trim().length > 0
        ? this.override.trim().replace(/\/+$/, "")
        : this.defaultBaseUrl;

    const mirrorList =
      this.mirrors.length > 1
        ? ` Known mirrors: ${this.mirrors.join(", ")}.`
        : "";

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if this source has moved to a new " +
            "domain or to switch mirrors. Leave empty to use the default. " +
            `Include the scheme, e.g. ${this.defaultBaseUrl}.${mirrorList}`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.override,
            onValueChange: Application.Selector<
              MangaBoxSettingsForm,
              (value: string) => Promise<void>
            >(this, "updateOverride"),
          }),
          LabelRow("base_url_current", {
            title: "Currently using",
            value: effective,
          }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector<
              MangaBoxSettingsForm,
              () => Promise<void>
            >(this, "resetOverride"),
          }),
        ],
      ),
    ];
  }
}
