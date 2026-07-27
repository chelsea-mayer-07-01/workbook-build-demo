# Casino High-Roller datasets (synthetic)

Generated 2026-07-27. Reproducible via `scripts` (seed fixed). All data is fake.

## Files
| File | Rows | Description |
|---|---|---|
| `casino_hosts.csv` | 20 | Casino hosts: `host_id, first_name, last_name` |
| `casino_players.csv` | 200 | Players (all high rollers): `player_id, first_name, last_name, date_of_birth, host_id, big_winner_flag` |
| `game_categories.csv` | 7 | Game legend: `category_id, game_name` |
| `casino_game_plays.csv` | 126,976 | One row per turn: `play_id, player_id, category_id, game_name, played_at, amount_bet, amount_won` |
| `load_snowflake.sql` | — | CREATE TABLE DDL + COPY load template |

## Design rules
- **All 200 players are high rollers:** total **wagered (handle)** per player per year is
  between **$75,000 and $500,000** — verified for all 600 player-years (3 years each).
- **Only a few (12) players are net winners:** `big_winner_flag = true`. Their annual
  winnings exceed their wagers (net positive up to ~+$231k/yr). Everyone else is a
  net loser (house wins 5–28% of handle), as expected.
- Games: Poker (C1), Blackjack (C2), $1 Slots (C3), $25 Slots (C4), Craps (C5),
  Electronic Games (C6), Roulette (C7). Play mix is table-game heavy.
- Timestamps span the last 3 years (2023-07-28 → 2026-07-27), clustered into visits.

## Keys
- `casino_players.host_id` → `casino_hosts.host_id`
- `casino_game_plays.player_id` → `casino_players.player_id`
- `casino_game_plays.category_id` → `game_categories.category_id`

## Notes on "spend"
Here "spend" = **total wagered (handle)**, per your instruction. Net loss/win is
derivable as `SUM(amount_bet) - SUM(amount_won)` per player per period.
