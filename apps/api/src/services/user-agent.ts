// Just enough user-agent parsing for the views table: no library, no raw UA stored.

// Crawlers, link unfurlers and headless tools. Unfurlers rarely run JS, but some render pages to take screenshots.
const BOT =
  /bot|crawl|spider|slurp|archiver|facebookexternalhit|meta-externalagent|whatsapp|telegram|slack|discord|skype|embedly|preview|vkshare|pinterest|bitly|quora|outbrain|headless|phantomjs|lighthouse|pagespeed|pingdom|uptime|monitor|curl|wget|python|httpclient|okhttp|go-http|java\/|axios|node-fetch|undici|postman/i;

export function isBot(ua: string): boolean {
  return ua.trim() === "" || BOT.test(ua);
}

export function deviceOf(ua: string): string {
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "Mobile";
  return "Desktop";
}

export function browserOf(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return "Other";
}
