const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const numberFormat = new Intl.NumberFormat("en-US");

export const formatDate = (d: Date) => dateFormat.format(d);
export const formatNumber = (n: number) => numberFormat.format(n);
export const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
