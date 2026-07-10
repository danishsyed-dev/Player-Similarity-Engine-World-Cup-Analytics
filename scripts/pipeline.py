"""
Player Similarity Engine — Pipeline
=====================================
Orchestrates the full data pipeline:
  1. Load data (scrape FBref or fall back to static dataset)
  2. Normalise & PCA
  3. Cosine similarity + top-5 neighbours
  4. Percentile-based radar charts
  5. Export ``web/data/players.json``
"""

import json
import os
import re
import sys
import unicodedata
from datetime import date

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "web", "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "players.json")

# ---------------------------------------------------------------------------
# Feature definitions
# ---------------------------------------------------------------------------

FEATURE_COLS = [
    "goals_per90", "assists_per90", "shots_per90", "shots_on_target_per90",
    "passes_completed_per90", "passes_attempted_per90", "pass_completion_pct",
    "key_passes_per90", "passes_into_final_third_per90", "progressive_passes_per90",
    "tackles_per90", "interceptions_per90", "blocks_per90", "clearances_per90",
    "dribbles_completed_per90", "dribbles_attempted_per90",
    "touches_per90", "carries_per90", "progressive_carries_per90",
    "aerial_duels_won_per90", "fouls_committed_per90", "fouls_drawn_per90",
]

RADAR_CATEGORIES = {
    "Shooting":    ["goals_per90", "shots_per90", "shots_on_target_per90"],
    "Creativity":  ["assists_per90", "key_passes_per90", "passes_into_final_third_per90"],
    "Passing":     ["passes_completed_per90", "pass_completion_pct", "progressive_passes_per90"],
    "Defending":   ["tackles_per90", "interceptions_per90", "blocks_per90", "clearances_per90"],
    "Possession":  ["touches_per90", "dribbles_completed_per90", "carries_per90", "progressive_carries_per90"],
    "Physical":    ["aerial_duels_won_per90", "fouls_committed_per90", "fouls_drawn_per90"],
}


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def slugify(name: str, year: int) -> str:
    """
    Turn a player name into a URL-safe slug, e.g.
    ``'Kylian Mbappé'`` → ``'kylian-mbappe-2022'``.
    """
    # Normalise unicode → ASCII (NFD → strip combining marks)
    nfkd = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Lowercase, replace non-alphanumeric with hyphens, collapse runs
    slug = ascii_name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return f"{slug}-{year}"


def percentile_of_score(values: np.ndarray, score: float) -> float:
    """
    Return the percentile rank of *score* within *values* (0-100).
    """
    if len(values) == 0:
        return 50.0
    count_below = np.sum(values < score)
    count_equal = np.sum(values == score)
    pct = ((count_below + 0.5 * count_equal) / len(values)) * 100.0
    return round(min(max(pct, 0.0), 100.0), 1)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data() -> pd.DataFrame:
    """
    Try FBref scraping first; on any failure fall back to the static dataset.
    """
    # ----- attempt live scrape -----
    try:
        print("> Attempting FBref scrape ...")
        # Add project root to sys.path so relative imports work when run as script
        if PROJECT_ROOT not in sys.path:
            sys.path.insert(0, PROJECT_ROOT)
        from scripts.scrape_fbref import scrape_fbref

        df = scrape_fbref()
        if df is not None and len(df) >= 10:
            print(f"  [OK] Scrape succeeded - {len(df)} players")
            return df
        else:
            print("  [WARN] Scrape returned insufficient data - falling back")
    except Exception as exc:
        print(f"  [WARN] Scrape failed ({type(exc).__name__}: {exc}) - falling back")

    # ----- fallback -----
    print("> Loading fallback data ...")
    from scripts.fallback_data import get_fallback_data

    df = get_fallback_data()
    print(f"  [OK] Fallback loaded - {len(df)} players")
    return df


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

def run_pipeline() -> dict:
    """
    Execute the full pipeline and return the JSON-ready dict.
    """

    # 1. Load data ----------------------------------------------------------
    df = load_data()
    print(f"\n> Data shape: {df.shape}")

    # Ensure all feature columns exist
    for col in FEATURE_COLS:
        if col not in df.columns:
            print(f"  [WARN] Missing column '{col}' - filling with 0")
            df[col] = 0.0

    # Fill NaN in numeric columns
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

    # Also coerce metadata columns
    for col in ["minutes_played", "matches_played", "age", "yellow_cards", "red_cards"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)

    n_players = len(df)
    print(f"  Players: {n_players}")

    # 2. Normalise features ------------------------------------------------
    print("\n> Normalising features (StandardScaler) ...")
    X_raw = df[FEATURE_COLS].values.astype(np.float64)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_raw)

    # Replace any remaining NaN / inf after scaling
    X_scaled = np.nan_to_num(X_scaled, nan=0.0, posinf=0.0, neginf=0.0)

    # 3. PCA ---------------------------------------------------------------
    print("> Running PCA ...")

    # Full PCA to find explained variance
    pca_full = PCA()
    pca_full.fit(X_scaled)
    cumvar = np.cumsum(pca_full.explained_variance_ratio_)

    # Number of components for 90 %+ variance
    n_components_90 = int(np.searchsorted(cumvar, 0.90) + 1)
    n_components_90 = min(n_components_90, X_scaled.shape[1], n_players)
    print(f"  Components for >= 90% variance: {n_components_90}")

    # Fit PCA with chosen components
    pca = PCA(n_components=n_components_90)
    X_pca = pca.fit_transform(X_scaled)

    explained_var = pca.explained_variance_ratio_.tolist()
    print(f"  Explained variance (first 5): {[round(v, 4) for v in explained_var[:5]]}")

    # 2D projection for scatter
    pca_2d = PCA(n_components=2)
    X_2d = pca_2d.fit_transform(X_scaled)

    # 4. Cosine similarity -------------------------------------------------
    print("> Computing cosine similarity ...")
    sim_matrix = cosine_similarity(X_pca)

    # 5. Radar charts (percentile-based) -----------------------------------
    print("> Computing radar chart values ...")

    # Pre-compute percentile arrays for each feature
    feature_values: dict[str, np.ndarray] = {}
    for col in FEATURE_COLS:
        feature_values[col] = df[col].values.astype(np.float64)

    def compute_radar(row_idx: int) -> dict[str, int]:
        radar: dict[str, int] = {}
        for cat_name, cat_cols in RADAR_CATEGORIES.items():
            pcts = []
            for col in cat_cols:
                val = feature_values[col][row_idx]
                pct = percentile_of_score(feature_values[col], val)
                pcts.append(pct)
            radar[cat_name] = int(round(np.mean(pcts)))
        return radar

    # 6. Assemble player list ----------------------------------------------
    print("> Assembling player records ...")

    # Extract tournament year for slug
    def _year_from_tournament(t: str) -> int:
        match = re.search(r"(\d{4})", str(t))
        return int(match.group(1)) if match else 0

    players_list: list[dict] = []
    radars_cache: list[dict] = []

    for idx in range(n_players):
        row = df.iloc[idx]
        tournament_str = str(row.get("tournament", ""))
        year_val = _year_from_tournament(tournament_str)
        player_name = str(row.get("player", f"Player_{idx}"))
        pid = slugify(player_name, year_val)

        radar = compute_radar(idx)
        radars_cache.append(radar)

        stats_per90 = {}
        for col in FEATURE_COLS:
            stats_per90[col] = round(float(row[col]), 2)

        player_dict = {
            "id": pid,
            "name": player_name,
            "team": str(row.get("team", "")),
            "position": str(row.get("position", "")),
            "tournament": tournament_str,
            "age": int(row.get("age", 0)),
            "minutes_played": int(row.get("minutes_played", 0)),
            "matches_played": int(row.get("matches_played", 0)),
            "stats_per90": stats_per90,
            "radar": radar,
            "pca_x": round(float(X_2d[idx, 0]), 2),
            "pca_y": round(float(X_2d[idx, 1]), 2),
            "similar_players": [],  # filled below
        }
        players_list.append(player_dict)

    # 7. Top-5 similar players per player ----------------------------------
    print("> Finding top-5 similar players ...")

    for i in range(n_players):
        sims = sim_matrix[i].copy()
        sims[i] = -2.0  # exclude self
        top5_idx = np.argsort(sims)[::-1][:5]

        similar = []
        for j_idx in top5_idx:
            j = int(j_idx)
            similar.append({
                "id": players_list[j]["id"],
                "name": players_list[j]["name"],
                "team": players_list[j]["team"],
                "position": players_list[j]["position"],
                "tournament": players_list[j]["tournament"],
                "similarity": round(float(sims[j]), 4),
                "radar": radars_cache[j],
            })
        players_list[i]["similar_players"] = similar

    # 8. Build final JSON structure ----------------------------------------
    tournaments_seen = sorted(df["tournament"].dropna().unique().tolist())

    output = {
        "meta": {
            "generated_at": date.today().isoformat(),
            "tournaments": tournaments_seen,
            "total_players": n_players,
            "features_used": FEATURE_COLS,
            "pca_explained_variance": [round(v, 4) for v in explained_var],
        },
        "players": players_list,
    }

    return output


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def save_json(data: dict, path: str | None = None) -> str:
    """Write *data* to JSON at *path* (default: ``web/data/players.json``)."""
    if path is None:
        path = OUTPUT_FILE

    os.makedirs(os.path.dirname(path), exist_ok=True)

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)

    size_kb = os.path.getsize(path) / 1024
    print(f"\n[OK] Saved {path}  ({size_kb:.1f} KB)")
    return path


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("  Player Similarity Engine — Pipeline")
    print("=" * 60)

    data = run_pipeline()
    out_path = save_json(data)

    print("\n" + "=" * 60)
    print(f"  Done!  {data['meta']['total_players']} players written to:")
    print(f"  {out_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
