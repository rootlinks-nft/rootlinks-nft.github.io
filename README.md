# rootlinks-nft.github.io

Static mint site for Rootlinks (BNB Smart Chain). No build step, no CDN, no wallet connect: plain HTML/CSS/ES modules. Everything it reads comes from public BSC RPCs.

- Pages: `index.html` (home), `mint.html` (live counters, agent prompts, invite link), `lookup.html`, `sell.html` (Element guide + send-tree prompt), `docs.html` (contracts, rules, refund guarantee, agent files), `404.html`. All links are relative; `?invite=N` opens the invite prompts on `mint.html` and is carried on every internal link.
- The HTML is generated from shared partials by `site_dev/build_pages.py` (run it after editing page copy, not the .html files).
- Bilingual: English and Simplified Chinese (中文). Page copy is written twice in `build_pages.py` (`t(en, zh)`), `js/i18n.js` switches `<html lang>` (EN / 中 button in the dock and footer links, stored in localStorage, defaults to 中文 for `zh*` browsers). Agent prompts have a Chinese wording with byte-identical addresses, calldata, values and `baw` commands.
- `css/style.css`, `js/main.js` (page wiring; every block only runs if its elements are on the page)
- `js/config.js`: **the only place contract addresses live.** Empty = “Mint opens soon” and every prompt says STOP.
- `js/abi.js`: generated from `contracts/out` (do not edit by hand)
- `js/prompts.js`: builds the copy-paste agent prompts (exact function, args, value, calldata, `baw` commands)
- `js/chain.js`: read-only RPC (Multicall3 batching, RPC fallback)
- `llms.txt`, `skill.md`: instructions for AI agents (generated)
- `vendor/ethers-lite.min.mjs`: ethers v6 subset, MIT

Local preview: `python3 -m http.server -d . 8000` and open http://localhost:8000/. Checks: `python3 site_dev/nav_test.py`, `python3 site_dev/shoot.py` (screenshots into `shots/`).

Credits: `CREDITS.md`. Community project; not affiliated with or endorsed by Binance, SPACE ID or Element.
