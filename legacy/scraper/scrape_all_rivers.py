import csv
import json
import re
import time
from playwright.sync_api import sync_playwright

INPUT_CSV = "/app/scripts/scotland_rivers.csv"
OUTPUT_JSON = "/app/scripts/scotland_rivers_detail.json"
OUTPUT_CSV = "/app/scripts/scotland_rivers_detail.csv"

# Fields to extract from the page text
FIELDS = [
    ("name_of_river", r"NAME OF RIVER:\s*(.+?)(?:\n|$)"),
    ("where_is_it", r"WHERE IS IT[?:]?\s*(.+?)(?=\n(?:PUT IN|APPROX|TIME|ACCESS|GRADING|WATER|MAJOR|GENERAL|OTHER|CONTRIBUTED|$))"),
    ("put_in_take_outs", r"PUT IN[/ ]*TAKE ?OUTS?:\s*(.+?)(?=\n(?:APPROX|TIME|ACCESS|GRADING|WATER|MAJOR|GENERAL|OTHER|CONTRIBUTED|$))"),
    ("approx_length", r"APPROX\.?\s*LENGTH:\s*(.+?)(?:\n|$)"),
    ("time_needed", r"TIME NEEDED:\s*(.+?)(?:\n|$)"),
    ("access_hassles", r"ACCESS HASSLES:\s*(.+?)(?:\n|$)"),
    ("grading", r"GRADING:\s*(.+?)(?:\n|$)"),
    ("water_level", r"WATER LEVEL INDICATORS?:\s*(.+?)(?=\n(?:MAJOR|GENERAL|OTHER|CONTRIBUTED|$))"),
    ("major_hazards", r"MAJOR HAZARDS?[/ ]*FALLS?:\s*(.+?)(?=\n(?:GENERAL|OTHER|CONTRIBUTED|$))"),
    ("general_description", r"GENERAL DESCRIPTION:\s*(.+?)(?=\n(?:OTHER|CONTRIBUTED|$))"),
    ("other_notes", r"OTHER NOTES:\s*(.+?)(?=\n(?:CONTRIBUTED|$))"),
    ("contributed_by", r"CONTRIBUTED BY:\s*(.+?)(?:\n|$)"),
]


def extract_fields(text):
    """Extract structured fields from page text."""
    data = {}
    for field_name, pattern in FIELDS:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            value = match.group(1).strip()
            # Clean up whitespace
            value = re.sub(r'\s+', ' ', value)
            data[field_name] = value
        else:
            data[field_name] = ""
    return data


def scrape_river(page, river):
    """Scrape a single river detail page."""
    url = river["url"]
    try:
        page.goto(url, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        # Small delay to let content render
        page.wait_for_timeout(500)

        # Get the main content text
        content = page.locator("body").text_content()

        # Extract fields
        data = extract_fields(content)
        data["region"] = river["region"]
        data["page_name"] = river["name"]
        data["url"] = url
        data["last_updated"] = ""

        # Try to get last updated date
        updated_match = re.search(r"Last Updated:\s*(.+?)[\n.]", content)
        if updated_match:
            data["last_updated"] = updated_match.group(1).strip()

        return data

    except Exception as e:
        print(f"    ERROR: {e}")
        return {
            "region": river["region"],
            "page_name": river["name"],
            "url": url,
            "error": str(e),
            **{field: "" for field, _ in FIELDS},
            "last_updated": ""
        }


# Load river URLs from CSV
rivers = []
with open(INPUT_CSV, "r") as f:
    reader = csv.DictReader(f)
    for row in reader:
        rivers.append(row)

print(f"Loaded {len(rivers)} rivers to scrape\n")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    all_data = []
    total = len(rivers)

    for i, river in enumerate(rivers):
        print(f"[{i+1}/{total}] {river['name']} ({river['region']})")
        data = scrape_river(page, river)
        all_data.append(data)

        # Progress update every 25
        if (i + 1) % 25 == 0:
            print(f"  --- Progress: {i+1}/{total} ({(i+1)*100//total}%) ---\n")

    browser.close()

# Save JSON
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(all_data, f, indent=2, ensure_ascii=False)

# Save CSV
csv_fields = ["region", "page_name", "name_of_river", "grading", "approx_length",
              "time_needed", "where_is_it", "put_in_take_outs", "access_hassles",
              "water_level", "major_hazards", "general_description",
              "other_notes", "contributed_by", "last_updated", "url"]

with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=csv_fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(all_data)

print(f"\n{'='*50}")
print(f"DONE! Scraped {len(all_data)} river detail pages")
print(f"  JSON: {OUTPUT_JSON}")
print(f"  CSV:  {OUTPUT_CSV}")
print(f"{'='*50}")

# Summary stats
has_grading = sum(1 for d in all_data if d.get("grading"))
has_desc = sum(1 for d in all_data if d.get("general_description"))
has_length = sum(1 for d in all_data if d.get("approx_length"))
errors = sum(1 for d in all_data if d.get("error"))
print(f"\n  With grading: {has_grading}/{total}")
print(f"  With description: {has_desc}/{total}")
print(f"  With length: {has_length}/{total}")
print(f"  Errors: {errors}/{total}")
