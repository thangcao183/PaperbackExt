import { ButtonRow, Form, LabelRow, Section, WebViewRow, } from "@paperback/types";
const DOMAIN = "kmanga.kodansha.com";
const BASE_URL = `https://${DOMAIN}`;
/**
 * Settings form for K Manga.
 *
 * K Manga is a Nuxt single-page app with no standalone login URL — the login
 * flow is reached from the home page. This form exposes a "Log in" button that
 * opens the site in a WebView; once the user signs in, the session cookies set
 * by the site are captured via `onComplete` and persisted into the shared
 * cookie store so subsequent API requests (rentals/purchases) are authenticated.
 */
export class KMangaSettingsForm extends Form {
    cookieStorageInterceptor;
    constructor(cookieStorageInterceptor) {
        super();
        this.cookieStorageInterceptor = cookieStorageInterceptor;
    }
    /**
     * Persist the cookies captured from the login WebView. Expired cookies are
     * skipped. The form is reloaded so the status label refreshes.
     */
    async onLoginComplete(cookies) {
        for (const cookie of cookies) {
            if (cookie.expires && cookie.expires.getTime() <= Date.now())
                continue;
            this.cookieStorageInterceptor.setCookie(cookie);
        }
        this.reloadForm();
    }
    async onLoginCancel() {
        this.reloadForm();
    }
    /**
     * Clear all stored cookies (logs out / resets the captured session).
     */
    async logOut() {
        for (const cookie of this.cookieStorageInterceptor.cookies) {
            this.cookieStorageInterceptor.deleteCookie(cookie);
        }
        this.reloadForm();
    }
    isLoggedIn() {
        // A logged-in session carries Kodansha auth/session cookies beyond the
        // default `birthday` age-gate cookie. Treat any non-birthday cookie as a
        // sign the user has an active session.
        return this.cookieStorageInterceptor.cookies.some((c) => c.name.toLowerCase() !== "birthday");
    }
    getSections() {
        return [
            Section({
                id: "account",
                footer: "Log in to your Kodansha (K Manga) account to read chapters you " +
                    "have rented or purchased. The login page opens in a WebView and " +
                    "the resulting session cookies are stored on-device. Note: K Manga " +
                    "accounts and purchases are region-restricted to Japan.",
            }, [
                LabelRow("login_status", {
                    title: "Status",
                    value: this.isLoggedIn() ? "Logged in" : "Not logged in",
                }),
                WebViewRow("login_webview", {
                    title: "Log in",
                    request: {
                        url: `${BASE_URL}/`,
                        method: "GET",
                    },
                    onComplete: Application.Selector(this, "onLoginComplete"),
                    onCancel: Application.Selector(this, "onLoginCancel"),
                }),
                ButtonRow("logout", {
                    title: "Log out (clear session)",
                    onSelect: Application.Selector(this, "logOut"),
                }),
            ]),
        ];
    }
}
