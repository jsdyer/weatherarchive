import {aggregate,csvFor,daysBetween,distance,fields,reading,resource,stationId,rangeProblem,collectDailyPages} from './model.mjs?v=long-ranges';

const $ = id => document.getElementById(id);
const make = (tag,text,cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const link = (text,url) => Object.assign(make('a',text),{href:url,target:'_blank',rel:'noopener'});
const num = new Intl.NumberFormat('en-CA',{maximumFractionDigits:1});
const format = value => value === null ? '—' : num.format(value);
const dateLabel = value => value?.slice(0,10) || 'Unknown';
const monthLabel = month => new Intl.DateTimeFormat('en-CA',{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2000,month-1,1)));
let queryController;
let nearbyController;
let visible = {days:[],results:[]};

async function fetchItems(url, signal) {
  const response = await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),credentials:'omit',referrerPolicy:'no-referrer'});
  if (!response.ok) throw new Error(response.status === 429 ? 'ECCC is limiting requests. Try again shortly.' : 'ECCC returned HTTP '+response.status+'.');
  const payload = await response.json();
  if (!Array.isArray(payload.features)) throw new Error('ECCC returned an unfamiliar data format.');
  return payload;
}

async function stationResult(id,from,through,signal,progress) {
  const sources = {
    station: resource('climate-stations',{CLIMATE_IDENTIFIER:id}),
    daily: resource('climate-daily',{CLIMATE_IDENTIFIER:id,datetime:from+'/'+through,limit:'500',sortby:'LOCAL_DATE'}),
    normal: resource('climate-normals',{CLIMATE_IDENTIFIER:id,NORMAL_ID:'1',limit:'100'}),
  };
  const [station,daily,normal] = await Promise.allSettled([
    fetchItems(sources.station,signal),
    collectDailyPages(sources.daily,url=>fetchItems(url,signal),progress),
    fetchItems(sources.normal,signal),
  ]);
  const observed = new Map();
  for (const {properties:row} of daily.value || []) {
    const date = dateLabel(row.LOCAL_DATE);
    if (row.CLIMATE_IDENTIFIER === id && date >= from && date <= through) observed.set(date,row);
  }
  const metadata = station.value?.features[0]?.properties;
  const name = metadata?.STATION_NAME || observed.values().next().value?.STATION_NAME || id;
  const normals = new Map();
  for (const {properties:row} of normal.value?.features || []) {
    if (row.CLIMATE_IDENTIFIER === id && row.PERIOD === 'NORM' && row.PERIOD_BEGIN === 1981 &&
        row.PERIOD_END === 2010 && reading(row.VALUE) !== null && row.MONTH >= 1 && row.MONTH <= 12) {
      normals.set(row.MONTH,row);
    }
  }
  return {id,name,metadata,observed,normals,sources,
    error: daily.status === 'rejected' ? 'Daily download failed. '+(daily.reason?.message || 'Please try again.') : null, normalError:normal.status === 'rejected'};
}

function renderSummary(result,days,index) {
  const tile = make('article',undefined,'panel summary'+(index?' alt':''));
  tile.append(make('h3',result.name),make('p',result.id+' · Daily archive '+dateLabel(result.metadata?.DLY_FIRST_DATE)+' to '+dateLabel(result.metadata?.DLY_LAST_DATE),'quiet'));
  const rows = days.map(day=>result.observed.get(day));
  const sum = (total,value)=>total+value;
  const mean = aggregate(rows,'MEAN_TEMPERATURE',sum,0);
  const rain = aggregate(rows,'TOTAL_PRECIPITATION',sum,0);
  const peak = aggregate(rows,'MAX_TEMPERATURE',Math.max,-Infinity);
  const lowest = aggregate(rows,'MIN_TEMPERATURE',Math.min,Infinity);
  const dl = make('dl');
  for (const [title,value] of [
    ['Mean observed temperature',mean.count ? format(mean.value/mean.count)+' °C ('+mean.count+' days)' : '—'],
    ['Observed high / low',format(peak.value)+' / '+format(lowest.value)+' °C'],
    ['Observed precipitation',rain.count ? format(rain.value)+' mm ('+rain.count+'/'+days.length+' days)' : '—'],
  ]) dl.append(make('dt',title),make('dd',value));
  tile.append(dl);
  const months = [...new Set(days.map(day=>Number(day.slice(5,7))))];
  const baseline = [];
  for (const month of months) {
    const normal = result.normals.get(month);
    if (normal) baseline.push(monthLabel(month)+' '+format(normal.VALUE)+' °C'+(Number.isInteger(normal.YEAR_COUNT_NORMAL_PERIOD)?' ('+normal.YEAR_COUNT_NORMAL_PERIOD+' years)':''));
  }
  if (result.error) tile.append(make('p',result.error,'quiet'));
  tile.append(make('p',result.normalError ? 'The ECCC normals service was unavailable.' : baseline.length
    ? '1981–2010 monthly mean · '+baseline.join(' · ')
    : 'ECCC returned no 1981–2010 monthly mean for the selected months at this station.','quiet'));
  const sources = make('p',undefined,'quiet sources');
  sources.append(link('Station record ↗',result.sources.station),link('Daily data ↗',result.sources.daily),link('Monthly baseline ↗',result.sources.normal));
  tile.append(sources);
  return tile;
}

function updateChart() {
  const chart = $('chart');
  if ($('results').hidden) return;
  const {days,results} = visible;
  const temperature = results.flatMap(({observed})=>days.map(day=>reading(observed.get(day)?.MEAN_TEMPERATURE))).filter(value=>value !== null);
  chart.hidden = temperature.length === 0;
  $('chart-detail').textContent = temperature.length
    ? results.map((result,index)=>(index?'Orange · ':'Mint · ')+result.name).join('   /   ')+'  —  Gaps indicate missing daily means.'
    : 'No daily mean temperature is available for this range.';
  if (!temperature.length) return;
  const width = chart.clientWidth;
  const height = chart.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  chart.width = Math.round(width*ratio);
  chart.height = Math.round(height*ratio);
  const ctx = chart.getContext('2d');
  if (!ctx) return;
  ctx.scale(ratio,ratio);
  const pad = {left:43,right:14,top:18,bottom:28};
  const min = Math.floor((Math.min(...temperature)-1)/5)*5;
  const max = Math.ceil((Math.max(...temperature)+1)/5)*5;
  const x = index => pad.left+(width-pad.left-pad.right)*(days.length===1 ? .5 : index/(days.length-1));
  const y = value => pad.top+(height-pad.top-pad.bottom)*(max-value)/(max-min);
  ctx.font = '12px system-ui';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (let i=0;i<=4;i++) {
    const value = min+(max-min)*i/4;
    ctx.strokeStyle = '#405364';
    ctx.beginPath();ctx.moveTo(pad.left,y(value));ctx.lineTo(width-pad.right,y(value));ctx.stroke();
    ctx.fillStyle = '#bacbd9';ctx.fillText(format(value),pad.left-6,y(value)+4);
  }
  ctx.textAlign='left'; ctx.fillText(days[0],pad.left,height-5);
  if (days.length>1) {ctx.textAlign='right';ctx.fillText(days.at(-1),width-pad.right,height-5);}
  results.forEach((result,index)=>{
    ctx.strokeStyle = index ? '#f5bd8c' : '#9de1ce';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let previous = false;
    for (const [i,day] of days.entries()) {
      const value = reading(result.observed.get(day)?.MEAN_TEMPERATURE);
      if (value === null) { previous=false; continue; }
      if (previous) ctx.lineTo(x(i),y(value)); else ctx.moveTo(x(i),y(value));
      ctx.fillRect(x(i)-1.5,y(value)-1.5,3,3);
      previous=true;
    }
    ctx.stroke();
  });
}

function render(days,results) {
  visible = {days,results};
  $('summaries').replaceChildren(...results.map((result,index)=>renderSummary(result,days,index)));
  const months = [...new Set(days.map(date=>date.slice(0,7)))];
  $('daily-month').replaceChildren(...months.map(month=>new Option(month,month)));
  renderTable();
  $('results').hidden = false;
  $('csv').disabled = !results.some(result=>result.observed.size);
  const measured = results.reduce((total,result)=> total+[...result.observed.values()].filter(row=>fields.some(([key])=>reading(row[key])!==null)).length,0);
  const failed = results.filter(result=>result.error);
  if (failed.length) {
    $('status').textContent = 'Daily download failed for '+failed.map(result=>result.name).join(', ')+'. Retry the comparison. '+(measured ? measured+' station-days have measurements in the completed download.' : '');
    $('csv').disabled = true;
  } else $('status').textContent = measured
    ? measured+' of '+days.length*results.length+' station-days have at least one measurement in the selected fields.'
    : 'No daily measurements were returned. Check station coverage below or choose a different date range.';
  updateChart();
}

function renderTable() {
  const {days,results} = visible;
  const cols = ['Date','Station',...fields.map(([,label])=>label)];
  const header = make('thead');
  const headings = make('tr');
  for (const col of cols) headings.append(Object.assign(make('th',col),{scope:'col'}));
  header.append(headings);
  const body = make('tbody');
  for (const day of days.filter(value=>value.startsWith($('daily-month').value))) {
    for (const result of results) {
      const row = make('tr');
      const data = result.observed.get(day) || {};
      const values = [day,result.name,...fields.map(([key])=>{
        const value = reading(data[key]);
        return format(value)+(value !== null && data[key+'_FLAG']?'*':'');
      })];
      for (const value of values) row.append(make('td',value));
      body.append(row);
    }
  }
  $('observations').replaceChildren(header,body);
}

async function compare() {
  const a = $('station-a').value.trim().toUpperCase();
  const b = $('station-b').value.trim().toUpperCase();
  const from = $('start').value;
  const through = $('end').value;
  const problem = !stationId(a) ? 'Station A needs its seven-character ECCC climate ID.'
    : b && !stationId(b) ? 'Station B needs its seven-character ECCC climate ID, or leave it blank.'
    : rangeProblem(from,through);
  if (problem) {
    queryController?.abort();
    queryController = null;
    $('results').hidden = true;
    $('status').textContent = problem;
    return;
  }
  queryController?.abort();
  const controller = new AbortController();
  queryController = controller;
  const parameters = {a,b,from,through};
  const current = new URL(location.href);
  current.search = new URLSearchParams(parameters).toString();
  history.replaceState(null,'',current);
  $('status').textContent = 'Loading station records, daily readings and climate normals…';
  $('results').hidden = true;
  const progress = new Map();
  const results = await Promise.all([...new Set([a,b].filter(Boolean))].map(id=>
    stationResult(id,from,through,controller.signal,count=>{
      if (queryController !== controller) return;
      progress.set(id,count);
      $('status').textContent = 'Reading ECCC daily observations · '+Array.from(progress,([code,n])=>code+' ('+n+')').join(' · ');
    })));
  if (queryController === controller) render(daysBetween(from,through),results);
}

function setExample(a,b,from,through) {
  $('station-a').value = a;
  $('station-b').value = b;
  $('start').value = from;
  $('end').value = through;
  compare();
}

async function findNearby() {
  const lat = $('lat').valueAsNumber;
  const lon = $('lon').valueAsNumber;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return;
  nearbyController?.abort();
  const controller = new AbortController();
  nearbyController = controller;
  const timer = setTimeout(()=>controller.abort(),20000);
  const box = [Math.max(-180,lon-.35),Math.max(-90,lat-.26),Math.min(180,lon+.35),Math.min(90,lat+.26)];
  $('stations').replaceChildren();
  $('finder-status').textContent = 'Searching nearby climate stations…';
  try {
    const collection = await fetchItems(resource('climate-stations',{bbox:box.join(','),limit:'250'}),controller.signal);
    if (nearbyController !== controller) return;
    const stations = [];
    for (const item of collection.features) {
      const entry = item.properties;
      const point = item.geometry?.coordinates;
      if (entry.DLY_FIRST_DATE && stationId(entry.CLIMATE_IDENTIFIER) && point?.length === 2) {
        stations.push({entry,km:distance(lat,lon,point[1],point[0])});
      }
    }
    const distances = stations.sort((a,b)=>a.km-b.km).slice(0,24);
    $('finder-status').textContent = distances.length
      ? 'Showing '+distances.length+' nearby stations with daily archive dates. Use A or B to fill the comparison.'
      : 'No nearby stations with a listed daily archive were found.';
    for (const {entry,km} of distances) {
      const li = make('li');
      const label = make('div');
      label.append(make('strong',entry.STATION_NAME),make('span',' · '+format(km)+' km · '+dateLabel(entry.DLY_FIRST_DATE)+' to '+dateLabel(entry.DLY_LAST_DATE)));
      const choices = make('div',undefined,'actions');
      for (const side of ['A','B']) {
        const button = make('button','Use '+side,'secondary');
        button.type = 'button';
        button.setAttribute('aria-label','Use '+entry.STATION_NAME+' as station '+side);
        button.addEventListener('click',()=>{
          const field = $('station-'+side.toLowerCase());
          field.value = entry.CLIMATE_IDENTIFIER;
          field.focus();
        });
        choices.append(button);
      }
      li.append(label,choices);
      $('stations').append(li);
    }
  } catch (error) {
    if (nearbyController === controller) $('finder-status').textContent = error.name === 'AbortError' ? 'Station search timed out.' : 'Station search unavailable. '+error.message;
  } finally { clearTimeout(timer); }
}

$('compare').addEventListener('submit',event=>{event.preventDefault();compare();});
$('nearby').addEventListener('submit',event=>{event.preventDefault();findNearby();});
$('example').addEventListener('click',()=>setExample('1104570','8202251','2026-08-31','2026-09-18'));
$('historical').addEventListener('click',()=>setExample('8202250','1108447','2009-07-25','2009-08-02'));
for (const button of document.querySelectorAll('[data-point]')) {
  button.addEventListener('click',()=>{
    [$('lat').value,$('lon').value] = button.dataset.point.split(',');
    findNearby();
  });
}
$('daily-month').addEventListener('change',renderTable);
$('full-year').addEventListener('click',()=>setExample('1104570','8202251','2024-01-01','2024-12-31'));
$('csv').addEventListener('click',()=>{
  const url = URL.createObjectURL(new Blob([csvFor(visible.days,visible.results)],{type:'text/csv;charset=utf-8'}));
  const download = make('a');
  download.href = url;
  download.download = 'weather-archive-'+visible.days[0]+'.csv';
  download.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
if ('ResizeObserver' in window) new ResizeObserver(updateChart).observe($('chart').parentElement);
const parameters = new URLSearchParams(location.search);
if (parameters.has('a')) {
  setExample(parameters.get('a'),parameters.get('b')||'',parameters.get('from')||'',parameters.get('through')||'');
} else {
  compare();
}
