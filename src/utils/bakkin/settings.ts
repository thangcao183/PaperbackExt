import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  ToggleRow,
} from "@paperback/types";

const BASE_URL_KEY_PREFIX = "bakkin.baseUrlOverride.";
const FULLSIZE_KEY_PREFIX = "bakkin.fullsize.";

function baseUrlKey(sourceName: string): string {
  return `${BASE_URL_KEY_PREFIX}${sourceName}`;
}

function fullsizeKey(sourceName: string): string {
  return `${FULLSIZE_KEY_PREFIX}${sourceName}`;
}

/**
 * Returns the user-configured base URL override for a source, or undefined
 * when none is set. A trailing slash is always ensured because Bakkin
 * appends "main.php" directly to the base URL.
 */
export function getBaseUrlOverride(sourceName: string): string | undefined {
  const value = Application.getState(baseUrlKey(sourceName));
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) {
      return `${trimmed}/`;
    }
  }
  return undefined;
}

function setBaseUrlOverride(sourceName: string, value: string): void {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(trimmed, baseUrlKey(sourceName));
}

/**
 * Whether full-size (uncompressed) images should be requested. Defaults to
 * false (compressed).
 */
export function getFullsizeImages(sourceName: string): boolean {
  const value = Application.getState(fullsizeKey(sourceName));
  return typeof value === "boolean" ? value : false;
}

function setFullsizeImages(sourceName: string, value: boolean): void {
  Application.setState(value, fullsizeKey(sourceName));
}

export class BakkinSettingsForm extends Form {
  private override: string;
  private fullsize: boolean;

  constructor(
    private readonly sourceName: string,
    private readonly defaultBaseUrl: string,
  ) {
    super();
    const stored = Application.getState(baseUrlKey(sourceName));
    this.override = typeof stored === "string" ? stored : "";
    this.fullsize = getFullsizeImages(sourceName);
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

  async updateFullsize(value: boolean): Promise<void> {
    this.fullsize = value;
    setFullsizeImages(this.sourceName, value);
    this.reloadForm();
  }

  override getSections() {
    const effective =
      this.override.trim().length > 0
        ? `${this.override.trim().replace(/\/+$/, "")}/`
        : this.defaultBaseUrl;

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if this source has moved to a new " +
            "domain (required for self-hosted instances). Leave empty to use " +
            `the default. Include the scheme, e.g. ${this.defaultBaseUrl}`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.override,
            onValueChange: Application.Selector<
              BakkinSettingsForm,
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
              BakkinSettingsForm,
              () => Promise<void>
            >(this, "resetOverride"),
          }),
        ],
      ),
      Section(
        {
          id: "images",
          footer:
            "Request full-size (uncompressed) images instead of compressed " +
            "ones. Uses more bandwidth.",
        },
        [
          ToggleRow("fullsize_images", {
            title: "Full-size images",
            value: this.fullsize,
            onValueChange: Application.Selector<
              BakkinSettingsForm,
              (value: boolean) => Promise<void>
            >(this, "updateFullsize"),
          }),
        ],
      ),
    ];
  }
}
