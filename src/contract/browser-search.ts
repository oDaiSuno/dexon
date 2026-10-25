export const BROWSER_SEARCH_ENGINES = ["bing", "google", "duckduckgo", "baidu", "custom"] as const;

export type BrowserSearchEngine = (typeof BROWSER_SEARCH_ENGINES)[number];

export const BROWSER_SEARCH_TEMPLATES: Record<Exclude<BrowserSearchEngine, "custom">, string> = {
  bing: "https://www.bing.com/search?q={query}",
  google: "https://www.google.com/search?q={query}",
  duckduckgo: "https://duckduckgo.com/?q={query}",
  baidu: "https://www.baidu.com/s?wd={query}",
};

export function isBrowserSearchTemplate(value: string): boolean {
  if (value.length > 2_048 || !value.includes("{query}") || /[\r\n]/.test(value)) return false;
  try {
    const url = new URL(value.replaceAll("{query}", "q"));
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function browserSearchUrl(
  navigation: { searchEngine: BrowserSearchEngine; customSearchTemplate: string },
  query: string,
): string {
  const template =
    navigation.searchEngine === "custom"
      ? isBrowserSearchTemplate(navigation.customSearchTemplate)
        ? navigation.customSearchTemplate
        : BROWSER_SEARCH_TEMPLATES.bing
      : BROWSER_SEARCH_TEMPLATES[navigation.searchEngine];
  return template.replaceAll("{query}", encodeURIComponent(query));
}
