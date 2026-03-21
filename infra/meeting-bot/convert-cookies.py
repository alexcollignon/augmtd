"""
Converts Cookie-Editor Chrome export → Playwright storage_state format.
Usage: python3 convert-cookies.py
"""
import json

with open('/tmp/chrome-cookies.json') as f:
    chrome_cookies = json.load(f)

SAME_SITE_MAP = {
    "strict": "Strict",
    "lax": "Lax",
    "none": "None",
    "no_restriction": "None",
    "unspecified": "Lax",
}

playwright_cookies = []
for c in chrome_cookies:
    raw_same_site = str(c.get("sameSite", "lax")).lower()
    same_site = SAME_SITE_MAP.get(raw_same_site, "Lax")
    playwright_cookies.append({
        "name": c["name"],
        "value": c["value"],
        "domain": c["domain"],
        "path": c.get("path", "/"),
        "expires": c.get("expirationDate", -1),
        "httpOnly": c.get("httpOnly", False),
        "secure": c.get("secure", False),
        "sameSite": same_site,
    })

storage_state = {"cookies": playwright_cookies, "origins": []}

with open("google-auth.json", "w") as f:
    json.dump(storage_state, f, indent=2)

print(f"✓ Converted {len(playwright_cookies)} cookies → google-auth.json")
print("  Upload with:")
print("  scp google-auth.json root@46.224.176.245:/root/augmtd-infra/infra/meeting-bot/")
