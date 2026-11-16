const dayMs = 86_400_000;
const climate = new URL('https://api.weather.gc.ca/collections/');
export const fields = [
  ['MEAN_TEMPERATURE', 'Mean °C'], ['MIN_TEMPERATURE', 'Min °C'],
  ['MAX_TEMPERATURE', 'Max °C'], ['TOTAL_PRECIPITATION', 'Precip mm'],
  ['TOTAL_SNOW', 'Snow cm'], ['SPEED_MAX_GUST', 'Gust km/h'],
];

export const stationId = value => /^[A-Z0-9]{7}$/.test(value);
export function validRange(from, through) {
  const start = new Date(from);
  const end = new Date(through);
  const valid = (date, value) => Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  return valid(start, from) && valid(end, through) && end >= start && end - start < 92 * dayMs;
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
