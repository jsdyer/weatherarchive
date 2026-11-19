const dayMs = 86_400_000;
const climate = new URL('https://api.weather.gc.ca/collections/');
export const fields = [
  ['MEAN_TEMPERATURE', 'Mean °C'], ['MIN_TEMPERATURE', 'Min °C'],
  ['MAX_TEMPERATURE', 'Max °C'], ['TOTAL_PRECIPITATION', 'Precip mm'],
  ['TOTAL_SNOW', 'Snow cm'], ['SPEED_MAX_GUST', 'Gust km/h'],
];

export const stationId = value => /^[A-Z0-9]{7}$/.test(value);
export function rangeProblem(from, through) {
  const start = new Date(from);
  const end = new Date(through);
  const valid = (date, value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  if (!valid(start, from) || !valid(end, through)) return 'Choose a valid start date and end date.';
  if (end < start) return 'The end date must fall on or after the start date.';
  const limit = new Date(start);
  limit.setUTCFullYear(limit.getUTCFullYear() + 30);
  if (end >= limit) return 'Choose up to 30 years per comparison. You can download consecutive ranges as CSV.';
  return '';
}

export const validRange = (from, through) => !rangeProblem(from, through);

export async function collectDailyPages(firstUrl, fetchPage, progress = () => {}) {
  let url = new URL(firstUrl);
  const seen = new Set();
  const rows = [];
  for (;;) {
    if (seen.has(url.href)) throw new Error('ECCC repeated a page of daily observations.');
    seen.add(url.href);
    const page = await fetchPage(url);
    rows.push(...page.features);
    progress(rows.length);
    const next = page.links?.find(link => link.rel === 'next');
    if (!next) {
      if (Number.isSafeInteger(page.numberMatched) && rows.length < page.numberMatched)
        throw new Error('ECCC ended the download before all daily observations arrived.');
      return rows;
    }
    const upcoming = new URL(next.href, url);
    if (upcoming.origin !== climate.origin || upcoming.pathname !== url.pathname)
      throw new Error('ECCC returned an unexpected daily observations link.');
    upcoming.searchParams.set('f', 'json');
    url = upcoming;
  }
}

export function daysBetween(from, through) {
  if (!validRange(from, through)) return [];
  return Array.from({length: (Date.parse(through) - Date.parse(from)) / dayMs + 1},
    (_, index) => new Date(Date.parse(from) + index * dayMs).toISOString().slice(0, 10));
}

export function resource(collection, parameters) {
  const url = new URL(collection + '/items', climate);
  url.search = new URLSearchParams({f:'json', ...parameters}).toString();
  return url;
}

export function distance(lat, lon, targetLat, targetLon) {
  const rad = degree => degree * Math.PI / 180;
  const a = Math.sin(rad(targetLat - lat) / 2) ** 2 +
    Math.cos(rad(lat)) * Math.cos(rad(targetLat)) * Math.sin(rad(targetLon - lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export const reading = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export function aggregate(rows, key, reduce, initial) {
  const values = rows.map(row => reading(row?.[key])).filter(value => value !== null);
  return {count: values.length, value: values.length ? values.reduce(reduce, initial) : null};
}

export function csvFor(days, results) {
  const escape = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const lines = [['station_id','station_name','date',...fields.flatMap(([key])=>[key,key+'_FLAG'])]];
  for (const result of results) {
    for (const day of days) {
      const record = result.observed.get(day) || {};
      lines.push([result.id,result.name,day,...fields.flatMap(([key])=>[reading(record[key]),record[key+'_FLAG']])]);
    }
  }
  return lines.map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
}
