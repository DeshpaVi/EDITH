"""Small static gazetteer for the POC.

TODO(geocode): replace with a real lookup (e.g. Amazon Location Service). Unknown
places must never score as "unique city"; the scorer treats them as unverified.
"""

STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
    "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}
STATE_ABBRS = set(STATES.values())

# City names that resolve to a single well-known city.
UNIQUE_CITIES = {
    "phoenix": "AZ", "dallas": "TX", "houston": "TX", "denver": "CO", "tampa": "FL",
    "seattle": "WA", "atlanta": "GA", "miami": "FL", "san diego": "CA", "san antonio": "TX",
    "austin": "TX", "boston": "MA", "chicago": "IL", "detroit": "MI", "orlando": "FL",
    "las vegas": "NV", "minneapolis": "MN", "nashville": "TN", "sacramento": "CA",
    "tucson": "AZ", "charlotte": "NC", "baltimore": "MD", "pittsburgh": "PA",
    "cleveland": "OH", "raleigh": "NC",
}

# Names shared by several states: the state must be confirmed.
AMBIGUOUS_CITIES = {
    "columbus", "springfield", "portland", "aurora", "kansas city", "rochester",
    "richmond", "charleston", "glendale", "arlington", "jacksonville", "salem",
}

# Spoken short forms -> (city, state). Normalize, then confirm.
ALIASES = {
    "la": ("Los Angeles", "CA"), "l.a.": ("Los Angeles", "CA"),
    "nyc": ("New York", "NY"), "philly": ("Philadelphia", "PA"),
    "sf": ("San Francisco", "CA"), "vegas": ("Las Vegas", "NV"),
}

# Neighborhoods -> containing city. Map, then confirm.
NEIGHBORHOODS = {
    "brooklyn": ("New York", "NY"), "queens": ("New York", "NY"), "the bronx": ("New York", "NY"),
    "manhattan": ("New York", "NY"), "hollywood": ("Los Angeles", "CA"),
}
