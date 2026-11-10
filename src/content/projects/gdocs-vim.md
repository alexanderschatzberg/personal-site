---
title: Vim for Google Docs
description: A Firefox extension that adds Vim keybindings to Google Docs, with the system clipboard as the register and a clean handoff to Tridactyl.
image: /images/projects/gdocs-vim.svg
imageAlt: Vim for Google Docs logo
imageFit: contain
url: https://github.com/alexanderschatzberg/gdocs-vim
date: 2026-11-03
order: 1
---

Vim keybindings inside Google Docs: motions, operators, text objects, visual mode, counts and `.` repeat. Clicking into a doc starts in Insert mode, so Docs works as usual until you press `Esc`.

- **One register, the system clipboard.** `y`, `d`, `c` and `x` all copy, like Vim with `clipboard=unnamedplus`. Copies keep Docs formatting.
- **`Esc` in Normal mode leaves the doc,** so Tridactyl's keys work again.
- **`/` and `?` use Docs' own Find box,** with `n` / `N` between matches.

## How it works

Docs draws text on a canvas and sends all typing through a hidden input inside an iframe. The extension catches keys there before Docs sees them and drives Docs with synthetic key events. To read text for motions like `w` or `f`, it selects the text and fires a synthetic `copy` event, which Docs fills in without touching the clipboard.

Open source under the MIT license.
