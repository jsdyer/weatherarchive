"""Check the published interface against live ECCC daily data and controlled failure responses."""
import csv
import io
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

from playwright.sync_api import sync_playwright, expect

STATIONS = ["1104570", "8202251"]
PERIOD = {"a": STATIONS[0], "b": STATIONS[1], "from": "2024-01-01", "through": "2025-12-31"}
URL = "https://coolcode.ca/weatherarchive/?" + urlencode(PERIOD)
DAILY = "https://api.weather.gc.ca/collections/climate-daily/items*"


def check(browser):
    page = browser.new_page()
    page.set_default_timeout(10000)
    errors, response_pages = [], {station: [] for station in STATIONS}
    page.on("pageerror", lambda error: errors.append(str(error)))

    def received(response):
        if "/climate-daily/items?" in response.url:
            query = parse_qs(urlsplit(response.url).query)
            response_pages[query["CLIMATE_IDENTIFIER"][0]].append(response)

    page.on("response", received)
    assert page.goto(URL, wait_until="domcontentloaded").status == 200
    expect(page.locator("#results")).to_be_visible(timeout=110000)
    status = page.locator("#status").inner_text()
    assert "of 1462 station-days" in status, status
    source = {}
    for station, pages in response_pages.items():
        sizes = []
        for response in pages:
            payload = response.json()
            sizes.append(len(payload["features"]))
            for item in payload["features"]:
                row = item["properties"]
                assert row["CLIMATE_IDENTIFIER"] == station
                source[station, row["LOCAL_DATE"][:10]] = row
        assert sorted(sizes) == [231, 500], (station, sizes)
    assert len(source) == 1462
    table = page.locator("#observations tbody tr")
    assert page.locator("#daily-month option").count() == 24
    for month, last in (("2024-01", "31"), ("2024-02", "29"), ("2025-12", "31")):
        page.locator("#daily-month").select_option(month)
        assert table.count() == 2 * int(last)
        assert table.first.locator("td").first.inner_text() == month + "-01"
        assert table.last.locator("td").first.inner_text() == month + "-" + last

    with page.expect_download() as pending:
        page.locator("#csv").click()
    download = pending.value
    assert download.suggested_filename == "weather-archive-2024-01-01.csv"
    rows = list(csv.DictReader(io.StringIO(Path(download.path()).read_text())))
    assert Counter(r["station_id"] for r in rows) == {station: 731 for station in STATIONS}
    assert len({(r["station_id"], r["date"]) for r in rows}) == 1462
    for row in rows:
        native = source[row["station_id"], row["date"]]
        for key, value in row.items():
            if key in ("station_id", "station_name", "date"):
                continue
            orig = native.get(key)
            if isinstance(orig, (float, int)):
                assert float(value) == orig, (key, value, orig)
            else:
                assert value == (orig or ""), (key, value, orig)
    print(status, "Two live pages per station. January, leap February and December tables and all CSV values and flags verified.", flush=True)

    # Fulfil only the daily requests for the remaining error-path checks.
    page.remove_listener("response", received)
    page.route(DAILY, lambda route: route.fulfill(json={"features": [], "links": [], "numberMatched": 0}))
    page.get_by_role("button", name="Compare stations").click()
    expect(page.locator("#status")).to_contain_text("No daily measurements were returned", timeout=65000)
    expect(page.locator("#csv")).to_be_disabled()
    page.unroute(DAILY)

    def lose_second_page(route):
        query = parse_qs(urlsplit(route.request.url).query)
        if query.get("offset") and query.get("CLIMATE_IDENTIFIER") == [STATIONS[0]]:
            route.fulfill(status=503, json={"error": "Temporary failure"})
        else:
            route.continue_()

    page.route(DAILY, lose_second_page)
    page.get_by_role("button", name="Compare stations").click()
    expect(page.locator("#status")).to_contain_text("Daily download failed", timeout=110000)
    expect(page.locator("#summaries")).to_contain_text("HTTP 503")
    expect(page.locator("#csv")).to_be_disabled()
    print(page.locator("#status").inner_text(), "A successful empty response and a failed second page have distinct states.", flush=True)
    assert not errors, errors


if __name__ == "__main__":
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome")
        check(browser)
        browser.close()
