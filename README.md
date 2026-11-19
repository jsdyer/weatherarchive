# Weather Archive

Compare Canadian daily station observations from Environment and Climate Change Canada. Explore the station catalogue by coordinates, pick one or two station IDs, and query up to 92 days at a time. The charts and CSV keep daily gaps visible. Temperature normals use the same station ID and the ECCC 1981–2010 monthly mean series where available.

Run locally with `python3 -m http.server` and open http://localhost:8000. The site makes read-only, keyless requests to the MSC GeoMet API. It requires no build or backend. Publish on GitHub Pages using GitHub Actions.

- [Climate observations, normals and station catalogue](https://eccc-msc.github.io/open-data/msc-data/climate_obs/readme_climateobs-geomet_en/)
- [ECCC Data Services End-use Licence](https://eccc-msc.github.io/open-data/licence/readme_en/)

A station archive, including a series with a listed last observation date, may have missing values or changes in equipment. The CSV includes ECCC flags for the measurements displayed in the tool.

[Forecast Receipt](https://coolcode.ca/forecastreceipt/) compares saved forecasts with hourly readings at Langley Regional and Halifax Stanfield.
