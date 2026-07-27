#!/usr/bin/env python3
"""Generate synthetic casino high-roller datasets.

Rules:
- 200 players, ALL high rollers: total WAGERED (handle) per year in [75k, 500k]
  for each of the last 3 years.
- 20 hosts; each player assigned one host.
- game_plays: one row per turn, last 3 years, with timestamp, amount_bet, amount_won.
- 7 game categories, each with a unique category id.
- Only a FEW players (12) have significant net winnings in a year; the rest are
  net losers (house wins), as normal.
"""
import csv, os, random
from datetime import datetime, timedelta

random.seed(20260727)
OUT = "/home/user/workbook-build-demo/data/casino-high-rollers"
os.makedirs(OUT, exist_ok=True)

TODAY = datetime(2026, 7, 27)
YEAR_WINDOWS = [  # (label, start, end) — rolling 3 years
    ("Y-2", TODAY - timedelta(days=365*3), TODAY - timedelta(days=365*2)),
    ("Y-1", TODAY - timedelta(days=365*2), TODAY - timedelta(days=365*1)),
    ("Y-0", TODAY - timedelta(days=365*1), TODAY),
]

FIRST = ["James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda","David","Elizabeth",
"William","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Karen","Charles","Sarah",
"Christopher","Nancy","Daniel","Lisa","Matthew","Betty","Anthony","Margaret","Mark","Sandra",
"Donald","Ashley","Steven","Kimberly","Paul","Emily","Andrew","Donna","Joshua","Michelle",
"Kenneth","Carol","Kevin","Amanda","Brian","Dorothy","George","Melissa","Timothy","Deborah",
"Ronald","Stephanie","Edward","Rebecca","Jason","Sharon","Jeffrey","Laura","Ryan","Cynthia",
"Jacob","Kathleen","Gary","Amy","Nicholas","Angela","Eric","Shirley","Jonathan","Anna",
"Stephen","Ruth","Larry","Brenda","Justin","Pamela","Scott","Nicole","Brandon","Katherine",
"Wei","Priya","Omar","Sofia","Hiroshi","Fatima","Diego","Ingrid","Kwame","Yuki",
"Arjun","Elena","Mateo","Aaliyah","Sanjay","Noor","Lars","Chiara","Tariq","Mei"]
LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
"Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
"Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
"Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
"Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts",
"Patel","Kim","Chen","Okafor","Rossi","Novak","Haddad","Andersson","Sato","Reyes",
"Cohen","Murphy","Bailey","Cooper","Richardson","Cox","Howard","Ward","Peterson","Gray",
"Ramos","James","Watson","Brooks","Kelly","Sanders","Price","Bennett","Wood","Barnes"]

# ---- hosts ----
hosts = []
used_host_names = set()
for i in range(1, 21):
    while True:
        fn, ln = random.choice(FIRST), random.choice(LAST)
        if (fn, ln) not in used_host_names:
            used_host_names.add((fn, ln)); break
    hosts.append({"host_id": f"H{i:02d}", "first_name": fn, "last_name": ln})

# ---- players ----
players = []
used_player_names = set()
for i in range(1, 201):
    while True:
        fn, ln = random.choice(FIRST), random.choice(LAST)
        if (fn, ln) not in used_player_names:
            used_player_names.add((fn, ln)); break
    # high rollers skew older/established: DOB 1948-1996
    start = datetime(1948, 1, 1); end = datetime(1996, 12, 31)
    dob = start + timedelta(days=random.randint(0, (end - start).days))
    players.append({
        "player_id": f"P{i:04d}", "first_name": fn, "last_name": ln,
        "date_of_birth": dob.strftime("%Y-%m-%d"),
        "host_id": random.choice(hosts)["host_id"],
        "big_winner_flag": False,
    })
# a FEW consistent net winners
winner_idx = random.sample(range(200), 12)
for wi in winner_idx:
    players[wi]["big_winner_flag"] = True

# ---- game categories ----
# category_id, name, relative bet magnitude, rounding increment, min bet
CATS = [
    ("C1", "Poker",            1.10, 25, 25),
    ("C2", "Blackjack",        1.00, 25, 25),
    ("C3", "$1 Slots",         0.02,  1,  1),
    ("C4", "$25 Slots",        0.25, 25, 25),
    ("C5", "Craps",            1.00, 25, 10),
    ("C6", "Electronic Games", 0.12,  5,  5),
    ("C7", "Roulette",         0.70,  5,  5),
]
CAT_BY_ID = {c[0]: c for c in CATS}
# base game-mix weights (table-heavy, since everyone is a high roller)
BASE_MIX = {"C1":0.15,"C2":0.22,"C3":0.05,"C4":0.13,"C5":0.15,"C6":0.10,"C7":0.20}

def round_to(x, incr, minv):
    v = round(x / incr) * incr
    return max(minv, int(v))

def player_mix():
    w = {}
    for cid, base in BASE_MIX.items():
        w[cid] = max(0.01, random.gauss(base, base * 0.4))
    s = sum(w.values())
    return {k: v / s for k, v in w.items()}

def pick_games(mix, n):
    ids = list(mix.keys()); wts = [mix[i] for i in ids]
    return random.choices(ids, weights=wts, k=n)

plays = []
pid_counter = 1
audit = []  # per player-year (handle, won)

for p in players:
    mix = player_mix()
    is_winner = p["big_winner_flag"]
    for (ylabel, ystart, yend) in YEAR_WINDOWS:
        target_handle = random.uniform(76000, 498000)   # annual handle in band
        n_turns = random.randint(90, 320)               # bounds row count
        games = pick_games(mix, n_turns)

        # relative raw bets, then scale to hit target handle exactly
        raw = []
        for g in games:
            rel = CAT_BY_ID[g][2]
            noise = 2.718281828 ** random.gauss(0, 0.45)
            raw.append(max(1e-6, rel * noise))
        scale = target_handle / sum(raw)
        bets = []
        for g, r in zip(games, raw):
            _, _, _, incr, minv = CAT_BY_ID[g]
            bets.append(round_to(r * scale, incr, minv))
        # absorb rounding residual into the largest table-game turn
        residual = round(target_handle - sum(bets), 2)
        table_turns = [i for i, g in enumerate(games) if g in ("C1", "C2", "C5")]
        adj_i = max(table_turns, key=lambda i: bets[i]) if table_turns else max(range(n_turns), key=lambda i: bets[i])
        bets[adj_i] = max(CAT_BY_ID[games[adj_i]][4], int(bets[adj_i] + residual))
        total_bet = sum(bets)

        # winnings: RTP (return to player). winners > 1 (net positive); others net losers.
        rtp = random.uniform(1.06, 1.55) if is_winner else random.uniform(0.72, 0.95)
        total_won = total_bet * rtp
        # distribute wins: ~half turns are pure losses; rest carry weighted payouts
        wraw = []
        for b in bets:
            if random.random() < 0.5:
                wraw.append(0.0)
            else:
                wraw.append(b * (random.random() ** 2) * 4.0)
        if sum(wraw) == 0:
            wraw[0] = 1.0
        wscale = total_won / sum(wraw)
        wons = [round(w * wscale, 2) for w in wraw]
        wres = round(total_won - sum(wons), 2)
        mi = max(range(n_turns), key=lambda i: wons[i])
        wons[mi] = round(max(0.0, wons[mi] + wres), 2)

        # timestamps clustered into visits
        turns_per_visit = random.randint(15, 40)
        n_visits = max(1, n_turns // turns_per_visit)
        span_days = (yend - ystart).days
        visit_dates = sorted(random.sample(range(span_days), min(n_visits, span_days)))
        assign = [visit_dates[i % len(visit_dates)] for i in range(n_turns)]
        assign.sort()
        cur_day = None; t = None
        ordered = list(range(n_turns))
        for k in ordered:
            day = assign[k]
            if day != cur_day:
                cur_day = day
                hour = random.randint(17, 23)
                t = ystart + timedelta(days=day, hours=hour, minutes=random.randint(0, 59))
            else:
                t = t + timedelta(minutes=random.randint(2, 6))
            g = games[k]
            plays.append({
                "play_id": f"T{pid_counter:08d}",
                "player_id": p["player_id"],
                "category_id": g,
                "game_name": CAT_BY_ID[g][1],
                "played_at": t.strftime("%Y-%m-%d %H:%M:%S"),
                "amount_bet": f"{bets[k]:.2f}",
                "amount_won": f"{wons[k]:.2f}",
            })
            pid_counter += 1
        audit.append((p["player_id"], ylabel, total_bet, round(total_won, 2), is_winner))

# ---- write CSVs ----
def write_csv(path, rows, fields):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)

write_csv(f"{OUT}/casino_hosts.csv", hosts, ["host_id","first_name","last_name"])
write_csv(f"{OUT}/casino_players.csv", players,
          ["player_id","first_name","last_name","date_of_birth","host_id","big_winner_flag"])
write_csv(f"{OUT}/game_categories.csv",
          [{"category_id":c[0],"game_name":c[1]} for c in CATS], ["category_id","game_name"])
write_csv(f"{OUT}/casino_game_plays.csv", plays,
          ["play_id","player_id","category_id","game_name","played_at","amount_bet","amount_won"])

# ---- verification ----
print(f"hosts: {len(hosts)}  players: {len(players)}  categories: {len(CATS)}  plays: {len(plays)}")
handles = [a[2] for a in audit]
print(f"annual handle band: min ${min(handles):,.0f}  max ${max(handles):,.0f}  (target 75k-500k)")
in_band = all(75000 <= h <= 500000 for h in handles)
print(f"all {len(audit)} player-years in [75k,500k]: {in_band}")
nets_winners = [a[3]-a[2] for a in audit if a[4]]
nets_normal  = [a[3]-a[2] for a in audit if not a[4]]
print(f"big winners: {sum(p['big_winner_flag'] for p in players)} players")
print(f"  winner player-years net (won-bet): min ${min(nets_winners):,.0f} max ${max(nets_winners):,.0f} (positive = player ahead)")
print(f"  normal player-years net: min ${min(nets_normal):,.0f} max ${max(nets_normal):,.0f} (negative = house ahead)")
import os as _os
for fn in ["casino_hosts.csv","casino_players.csv","game_categories.csv","casino_game_plays.csv"]:
    print(f"  {fn}: {_os.path.getsize(OUT+'/'+fn)/1e6:.2f} MB")
