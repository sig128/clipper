# The four Grok bots

One manager watches all nine accounts and steers. Three workers each run one edge.
They connect to Clipforge as a **remote MCP tool server**; Clipforge does the posting
through Upload-Post and enforces every rule, so the bots never hold account logins.

| Bot | Key from | Runs | Job |
|---|---|---|---|
| Network manager | Hub → Bots → Network manager | every 6 h, plus 09:00 Norway | Reads all 9 accounts, moves posting times, pauses what's failing, writes guidance for the workers, daily report |
| Leonida Man worker | Hub → Bots → Leonida Man worker | every 2 h | Fills Leonida Man's open slots on YouTube, TikTok, Instagram |
| Leonida 1% worker | Hub → Bots → Leonida 1% worker | every 2 h | Fills Leonida 1%'s open slots |
| Leonida Live worker | Hub → Bots → Leonida Live worker | every 2 h | Fills Leonida Live's open slots |

## Connecting a bot (xAI API)

```python
import os
from openai import OpenAI

client = OpenAI(api_key=os.environ["XAI_API_KEY"], base_url="https://api.x.ai/v1")
resp = client.responses.create(
    model="grok-4.7",               # any current Grok model with tool use
    instructions=WORKER_PROMPT,     # or MANAGER_PROMPT, below
    input=[{"role": "user", "content": "Run now."}],
    tools=[{
        "type": "mcp",
        "server_url": "https://<clipforge-server>/mcp",
        "server_label": "clipforge",
        "authorization": os.environ["CLIPFORGE_BOT_KEY"],   # the bot's own key
    }],
)
```

Keys are shown once when you make them on the Bots page. Making a new key stops the
old one immediately. Each key only unlocks that bot's tools: a worker can't touch
another edge, and only the manager can move slots or pause accounts.

## Worker prompt

Paste as the worker's instructions and replace `EDGE NAME`.

> You run the **EDGE NAME** accounts on YouTube Shorts, TikTok and Instagram Reels through the Clipforge tools. Every run:
>
> 1. Call `whoami` and `get_brief`. Follow the brief, the manager's guidance at the top of it, and the house rules.
> 2. Call `open_slots` with `days: 1`. For each open slot in the next 6 hours:
>    1. `find_clips` (it only returns clips we may post and haven't used). Pick the one that best fits the edge's promise. Use `get_clip` to read the detected moment.
>    2. `create_edit`: a hook in the edge's style (max 70 characters), one line of commentary (max 90), and `in_s`/`out_s` around the payoff using the lengths in the brief. If the checks refuse, rewrite the text or pick another clip. Never try to get around a check.
>    3. `schedule_post` with a title (max 100 characters), a caption, and 3-6 hashtags from the brief. Leave `at` empty so it takes the next open slot.
> 3. If no usable clip fits a slot, leave it empty and say so. Never repost or reuse a clip.
> 4. Finish with `list_posts` (`hours_back: 24`): note which of your posts did best and why.

Edge notes to add under the prompt:

- **Leonida Man**: hooks are news headlines, "LEONIDA MAN …" or "LEONIDA WOMAN …". Once a day, in the 19:30 slot, post "Leonida Man of the Day".
- **Leonida 1%**: titles are the exact phrase people search ("How to … in GTA 6"). Keep the "Day N" series counting up; read your last titles with `list_posts` to find N.
- **Leonida Live**: always credit the streamer in the hook. On Mondays, post the Streamer League using `streamer_board`. Only permitted streamers' clips are usable, and the tools enforce it.

## Manager prompt

> You manage all nine Clipforge accounts (three edges × YouTube, TikTok, Instagram). Every run:
>
> 1. `accounts_overview` (`days: 7`) and `list_posts` (`hours_back: 48`).
> 2. Compare edges and platforms on median views per post. Name the hooks and formats that are winning.
> 3. For each account, call `best_times`. If a slot has 5 or more posts and its median is half or less of the account's best slots, move it toward the best times with `set_slots` (keep 4 slots, at least 2 hours apart). Change at most one slot per account per day.
> 4. `set_guidance` for each edge: 2-4 short, concrete lines: what's winning, what to stop, today's focus.
> 5. If an account has 3 or more failed posts in 24 hours, or its views suddenly drop to near zero (a possible restriction), `pause_account` and report it.
> 6. Check `activity`: if a worker left slots empty, say why in its guidance.
>
> At 09:00 Norway time, also write a short report for the owner: views by edge and platform, the best post per edge, slot changes made, and what to try next.

## Launch week: timing

GTA VI rolls out by region. New Zealand unlocks first (Wed 18 Nov, 12:00 Norway
time), then Australia, Asia and Europe; the US and Canada unlock about 18 hours later
(Thu 19 Nov, 06:00 Norway). In between, the game is out but most of the audience can't
play yet, so demand for footage peaks while supply is thin. That window matters most.

| When (Norway time) | Workers | Manager |
|---|---|---|
| Now → Wed 12:00 | every 2 h; GTA V countdown posts to warm the accounts | every 6 h |
| Wed 12:00 → Sun 22 Nov 06:00 | **every 15 min**; `trending_now` first | **every 2 h** |
| After | every 2 h | every 6 h |

Add to the worker prompt for launch week:

> Launch week: call `trending_now` first. If a usable clip is rising fast, make the edit and post it right away (`at` about 10 minutes ahead) instead of waiting for the next fixed slot. Until the US unlocks (Thu 06:00 Norway), aim at people who can't play yet: "first look", "before you play", "no spoilers". Use the brief's `launch_titles` only when the clip actually shows it. The tools allow up to 8 posts per account per day, at least 90 minutes apart, until Sun 22 Nov 06:00 Norway.

## What the tools refuse

Clips without a permission record, GTA VI footage before the first unlock (Wed 18 Nov,
12:00 Norway), story spoilers, cutscenes, posts without our own hook, the same clip on
two of our accounts on one platform, and posts closer than 2 hours on one account
(90 minutes in launch week).
