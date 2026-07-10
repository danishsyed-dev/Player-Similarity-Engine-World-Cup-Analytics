"""
FBref World Cup Player Stats Scraper
=====================================
Scrapes player statistics from FBref for FIFA World Cup tournaments.
Handles commented-out tables, multi-level headers, and implements
polite caching to avoid hammering the server.
"""

import os
import re
import time
import hashlib
import requests
import pandas as pd
import numpy as np
from bs4 import BeautifulSoup, Comment
from io import StringIO


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://fbref.com/en/comps/1/{year}/{category}/{year}-World-Cup-Stats"

STAT_CATEGORIES = [
    "stats",
    "shooting",
    "passing",
    "defense",
    "possession",
    "misc",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.google.com/",
    "Connection": "keep-alive",
}

# Column mapping from FBref raw names to our standardised names.
# Keys may appear as flat (single-level) or as "Group_Stat" after flattening
# multi-level headers.  We try several variants.
COLUMN_MAP = {
    # --- identifiers (from standard stats page) ---
    "Player":               "player",
    "Squad":                "team",
    "Pos":                  "position",
    "Age":                  "age",
    "Playing Time_Min":     "minutes_played",
    "Min":                  "minutes_played",
    "Playing Time_MP":      "matches_played",
    "MP":                   "matches_played",
    # --- standard / performance ---
    "Performance_Gls":      "goals",
    "Gls":                  "goals",
    "Performance_Ast":      "assists",
    "Ast":                  "assists",
    # --- shooting ---
    "Standard_Sh":          "shots",
    "Sh":                   "shots",
    "Standard_SoT":         "shots_on_target",
    "SoT":                  "shots_on_target",
    # --- passing ---
    "Total_Cmp":            "passes_completed",
    "Cmp":                  "passes_completed",
    "Total_Att":            "passes_attempted",
    "Att":                  "passes_attempted",
    "Total_Cmp%":           "pass_completion_pct",
    "Cmp%":                 "pass_completion_pct",
    "KP":                   "key_passes",
    "1/3":                  "passes_into_final_third",
    "PrgP":                 "progressive_passes",
    # --- defense ---
    "Tackles_Tkl":          "tackles",
    "Tkl":                  "tackles",
    "Int":                  "interceptions",
    "Blocks_Blocks":        "blocks",
    "Blocks":               "blocks",
    "Clr":                  "clearances",
    # --- possession ---
    "Touches_Touches":      "touches",
    "Touches":              "touches",
    "Dribbles_Succ":        "dribbles_completed",
    "Succ":                 "dribbles_completed",
    "Dribbles_Att":         "dribbles_attempted",
    "Carries_Carries":      "carries",
    "Carries":              "carries",
    "Carries_PrgC":         "progressive_carries",
    "PrgC":                 "progressive_carries",
    # --- misc ---
    "Aerial Duels_Won":     "aerial_duels_won",
    "Won":                  "aerial_duels_won",
    "Performance_CrdY":     "yellow_cards",
    "CrdY":                 "yellow_cards",
    "Performance_CrdR":     "red_cards",
    "CrdR":                 "red_cards",
    "Performance_Fls":      "fouls_committed",
    "Fls":                  "fouls_committed",
    "Performance_Fld":      "fouls_drawn",
    "Fld":                  "fouls_drawn",
}

# Columns we need raw totals for to compute per-90 versions
PER90_SOURCE_COLS = [
    "goals", "assists", "shots", "shots_on_target",
    "passes_completed", "passes_attempted",
    "key_passes", "passes_into_final_third", "progressive_passes",
    "tackles", "interceptions", "blocks", "clearances",
    "dribbles_completed", "dribbles_attempted",
    "touches", "carries", "progressive_carries",
    "aerial_duels_won", "fouls_committed", "fouls_drawn",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cache_dir():
    """Return the path to the cache directory, creating it if needed."""
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache = os.path.join(project_root, "data", "cache")
    os.makedirs(cache, exist_ok=True)
    return cache


def _cache_key(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest() + ".html"


def _fetch_html(url: str, session: requests.Session) -> str:
    """Fetch HTML from *url*, using a file-based cache."""
    cache = _cache_dir()
    path = os.path.join(cache, _cache_key(url))

    if os.path.exists(path):
        print(f"  [cache hit]  {url}")
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()

    print(f"  [fetching]   {url}")
    resp = session.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    html = resp.text

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)

    # Be polite
    time.sleep(4)
    return html


def _extract_tables_from_html(html: str) -> list[str]:
    """
    Return a list of HTML table strings found in *html*.

    FBref wraps some <table> elements inside HTML comments, so we
    also look inside ``<!-- ... -->`` blocks.
    """
    soup = BeautifulSoup(html, "lxml")
    table_strings: list[str] = []

    # 1. Visible tables
    for tbl in soup.find_all("table"):
        table_strings.append(str(tbl))

    # 2. Tables hidden inside comments
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment_text = str(comment)
        if "<table" in comment_text:
            inner_soup = BeautifulSoup(comment_text, "lxml")
            for tbl in inner_soup.find_all("table"):
                table_strings.append(str(tbl))

    return table_strings


def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten multi-level column headers by joining with '_'."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [
            "_".join(str(c).strip() for c in col if str(c).strip() and "Unnamed" not in str(c))
            for col in df.columns
        ]
    # Strip whitespace from column names
    df.columns = [str(c).strip() for c in df.columns]
    return df


def _parse_first_player_table(html: str) -> pd.DataFrame | None:
    """
    Parse the first *player-level* stats table out of *html*.

    Returns ``None`` if no usable table is found.
    """
    table_strings = _extract_tables_from_html(html)

    for tbl_html in table_strings:
        try:
            dfs = pd.read_html(StringIO(tbl_html), header=[0, 1])
        except Exception:
            try:
                dfs = pd.read_html(StringIO(tbl_html), header=0)
            except Exception:
                continue

        if not dfs:
            continue

        df = dfs[0]
        df = _flatten_columns(df)

        # FBref player tables always contain a "Player" column
        player_col = [c for c in df.columns if c.lower().replace("_", "") in ("player",)]
        if not player_col:
            # Try partial match
            player_col = [c for c in df.columns if "player" in c.lower()]
        if not player_col:
            continue

        # Drop aggregate / separator rows that FBref inserts
        pcol = player_col[0]
        df = df[df[pcol].notna()]
        df = df[~df[pcol].astype(str).str.contains("Player", case=False, na=False)]

        return df

    return None


def _rename_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename columns using COLUMN_MAP, trying multiple variants."""
    rename = {}
    for raw, std in COLUMN_MAP.items():
        if raw in df.columns and std not in rename.values():
            rename[raw] = std
    df = df.rename(columns=rename)
    return df


def _to_numeric(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Coerce *cols* to numeric, replacing non-numeric with NaN."""
    for c in cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


# ---------------------------------------------------------------------------
# Main scraping function
# ---------------------------------------------------------------------------

def scrape_fbref(years: list[int] | None = None) -> pd.DataFrame:
    """
    Scrape FBref World Cup player stats for the given *years*.

    Returns a single ``pd.DataFrame`` with one row per player-tournament,
    filtered to outfield players with >= 90 minutes played.
    """
    if years is None:
        years = [2014, 2018, 2022]

    session = requests.Session()
    all_tournament_dfs: list[pd.DataFrame] = []

    for year in years:
        print(f"\n{'='*60}")
        print(f"  Scraping {year} World Cup")
        print(f"{'='*60}")

        category_dfs: dict[str, pd.DataFrame] = {}

        for cat in STAT_CATEGORIES:
            url = BASE_URL.format(year=year, category=cat)
            try:
                html = _fetch_html(url, session)
            except requests.RequestException as exc:
                print(f"  [ERROR] Failed to fetch {cat}: {exc}")
                continue

            df = _parse_first_player_table(html)
            if df is None:
                print(f"  [WARN]  No player table found for {cat}")
                continue

            df = _rename_columns(df)
            print(f"  [OK]    {cat}: {len(df)} rows, cols={list(df.columns)[:8]}...")
            category_dfs[cat] = df

        if not category_dfs:
            print(f"  [SKIP]  No data for {year}")
            continue

        # Start with the standard stats table
        if "stats" not in category_dfs:
            print(f"  [SKIP]  Missing standard stats table for {year}")
            continue

        merged = category_dfs["stats"].copy()

        # Merge other categories on player + team
        merge_keys = []
        for key_col in ("player", "team"):
            if key_col in merged.columns:
                merge_keys.append(key_col)

        if not merge_keys:
            print(f"  [SKIP]  Cannot merge — missing player/team columns for {year}")
            continue

        for cat in STAT_CATEGORIES[1:]:
            if cat not in category_dfs:
                continue
            right = category_dfs[cat]
            # Only bring in columns we don't already have
            new_cols = [c for c in right.columns if c not in merged.columns or c in merge_keys]
            right_sub = right[new_cols].copy()
            merged = merged.merge(right_sub, on=merge_keys, how="left", suffixes=("", f"_{cat}"))

        # Add tournament label
        merged["tournament"] = f"{year} World Cup"

        all_tournament_dfs.append(merged)

    if not all_tournament_dfs:
        raise RuntimeError("Failed to scrape any tournament data from FBref.")

    df = pd.concat(all_tournament_dfs, ignore_index=True)

    # ------------------------------------------------------------------
    # Clean up
    # ------------------------------------------------------------------

    # Coerce numeric columns
    numeric_candidates = (
        ["minutes_played", "matches_played", "age", "yellow_cards", "red_cards",
         "pass_completion_pct"]
        + PER90_SOURCE_COLS
    )
    df = _to_numeric(df, numeric_candidates)

    # Filter goalkeepers
    if "position" in df.columns:
        df = df[~df["position"].astype(str).str.contains("GK", case=False, na=False)]

    # Simplify position to first listed (e.g. "FW,MF" → "FW")
    if "position" in df.columns:
        df["position"] = df["position"].astype(str).str.split(",").str[0].str.strip()
        df["position"] = df["position"].str.split(" ").str[0].str.strip()

    # Minimum 90 minutes
    if "minutes_played" in df.columns:
        df = df[df["minutes_played"] >= 90]

    # Compute per-90 stats
    if "minutes_played" in df.columns:
        nineties = df["minutes_played"] / 90.0
        nineties = nineties.replace(0, np.nan)  # avoid div-by-zero
        for col in PER90_SOURCE_COLS:
            per90_col = f"{col}_per90"
            if col in df.columns:
                df[per90_col] = (df[col] / nineties).round(2)
            else:
                df[per90_col] = 0.0

    # Fill remaining NaN
    df = df.fillna(0)

    # Reset index
    df = df.reset_index(drop=True)

    print(f"\n[OK] Scraped {len(df)} outfield players across {len(years)} tournaments.")
    return df


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    df = scrape_fbref()
    print(f"\nShape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(df.head(10).to_string())
