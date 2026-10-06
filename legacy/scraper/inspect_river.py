from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://www.ukriversguidebook.co.uk/rivers/scotland/far-north/aghairbhe", timeout=30000)
    page.wait_for_load_state("networkidle")

    page.screenshot(path="/app/scripts/river_detail.png", full_page=True)

    # Dump HTML
    html = page.content()
    with open("/app/scripts/river_detail.html", "w") as f:
        f.write(html)

    # Print all text content from main area
    body = page.locator("body")
    all_text = body.text_content()

    # Look for key data patterns
    import re
    for line in all_text.split("\n"):
        line = line.strip()
        if line and len(line) < 200:
            print(line)

    browser.close()
