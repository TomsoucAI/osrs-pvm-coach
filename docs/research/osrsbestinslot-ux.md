# osrsbestinslot.com Boss Gear Finder: UX analysis

Source: https://www.osrsbestinslot.com/boss-gear-finder/?boss=doom-of-mokhaiotl, its `/account-connect/` page, and the Vorkath guide page (read 2026-11-16 in a browser). Notes only: no text or assets copied.

Prototype verdict (2026-11-16, Tom): **variant B (paperdoll) wins. Visuals first, text second.** This site uses the same paperdoll-first layout and confirms the choice.

## 1. Layout

Three columns on one screen, with no scrolling needed for the core answer:

| Left rail: inputs | Centre: the answer, as a picture | Right rail: the verdict |
|---|---|---|
| Boss dropdown, style segmented control (Melee / Ranged / Magic), "load stats" field, 7 stat steppers, slayer-task checkbox, boost/potion, prayer (default "Auto, best for style"), defence drain (DWH ×1/×2, Elder maul ×1/×2, Arclight, Accursed), form/phase | Title "Best Ranged setup vs Doom" + "With Rigour", one-click boss chips, **equipment paperdoll with item icons**, a GE price tag under each slot, a budget slider, then a plain "Suggested items" list | **Hero card: DPS in large type**, 3 KPI tiles (max hit, accuracy, time to kill), setup value, 3 build-tier cards, then actions: pin to compare, open in DPS calc, export to RuneLite |

The page state is in the URL (`?boss=`), so a link reproduces the view.

## 2. Patterns worth copying (ranked by value for us)

1. **Paperdoll as the primary output.** Item icons in the OSRS equipment layout are read faster than a list, and the text list sits below as a secondary view.
2. **Hero metric + KPI tiles.** One big number (DPS) answers "how good". Three small tiles answer "why" (max hit, accuracy, TTK).
3. **Per-slot cyclers.** Hovering a slot shows ‹ › arrows to step through alternatives for that slot, plus a ↺ reset. The DPS updates in place. Exploration happens on the picture, not in a form.
4. **Build-tier cards.** "Best in slot / Near-BiS (≤5% less DPS) / Cheaper (≤18% less DPS)", each with its DPS. One click jumps to the tier. The cost of each option is visible before you choose.
5. **Smart defaults, stated plainly.** Prayer defaults to the best one for the style. Stats default to 99 and the page says so.
6. **One-click chips** for popular bosses above the result.
7. **Defence drains as a dropdown with the % shown** (e.g. "DWH ×2 (−51%)"), so you never compute the drain yourself.
8. **Form/phase selector** for multi-phase bosses.
9. **The guide page embeds the same tool** above the strategy text, and a skeleton paperdoll shows while it loads.
10. **Actions at the end of the verdict column:** pin to compare, open in the DPS calc, export to RuneLite.

## 3. What it does not do (our differentiators)

| Gap on the site | Our answer |
|---|---|
| Owned-gear mode needs their plugin to **upload** your skills, bank, inventory, location, trades (with other players' names), screenshots of trades and shops, and your IP to their server. | Everything stays on your PC: the plugin writes a local file and the UI binds `127.0.0.1`. |
| Price tags in GP. Useless for an ironman. | **Ownership badges** per slot: worn ✓ / inventory / bank / not owned. |
| Static snapshot: you sync, then refresh. | Live: the paperdoll updates as you swap in the bank. |
| No Maggot King, no TFA bosses in the boss list, and no written guide for Doom (checked 2026-11-16). | Our engine data already has Maggot King, Doom, Sol Heredit and the TFA bosses. |
| Phase is one dropdown; there is no plan across phases. | A fight plan: one paperdoll per phase, with the switches to bring. |
| Guides are generic articles (requirements, strategy, drops). | A **Boss Playbook** built from your account: unlocks you still need, supplies counted from your bank, travel with teleports you own, the fight by phase, the bank loop, and your progress. |
| No progress tracking. | Attempt history and trends per boss. |

## 4. How this maps onto our bank-mode screen (variant B, revised)

- **Left rail:** boss + phase, style segmented control, Planned/Live boosts, prayer "auto", drains dropdown with %, slayer task (read live, not a checkbox).
- **Centre:** two paperdolls, "Wearing now" and "Best you own", with item icons and ownership badges. Slots to swap are outlined. ‹ › cyclers step only through items you own.
- **Right rail:** hero DPS (now → best), KPI tiles, the thrall line, and tier cards **by swap count** instead of price: "Best owned", "≤ 2 swaps", "Wearing now".
- **Below:** the text list, a Playbook tab and a Progress tab.

## 5. Ground truth for strategy: OSRS Wiki `<Boss>/Strategies` pages

Tom's rule (2026-11-16): the wiki's strategy pages (https://oldschool.runescape.wiki/w/Category:Strategies) are the ground truth for how to kill a boss and for recommended gear. Checked through the wiki API (`action=parse&prop=sections`) on 2026-11-16:

- `Category:Strategies` lists 116 pages. `Maggot_King/Strategies` and `Doom_of_Mokhaiotl/Strategies` exist but are not in that category list, so the tool must look up `<Boss>/Strategies` by title, not only by category. `Fortis Colosseum/Strategies` is in the list.
- The section skeleton matches the Playbook flow almost one to one:

| Playbook step | Maggot King/Strategies sections | Doom of Mokhaiotl/Strategies sections |
|---|---|---|
| Unlocks | Requirements, Recommendations | Requirements, Recommendations |
| Getting there | Transportation | Transportation |
| The fight | Fight overview, Attack rotation, Ur-maggot larvae, Melee slams, Dharok's punish | Fight overview, Mechanics (8 subsections), Attack rotations, Table of attacks by delve level |
| Gear and inventory | Equipment | Equipment, Special attack weapons, Masori vs Elite void, Spellbook choice, Inventory setups |
| (not used) | Plugins | Plugins |

- The **wiki's Equipment section** says what to wear, given the mechanics (tank pieces, spec weapons, spellbook). **Our optimizer** gives the DPS ranking of what you own. They can disagree, because the wiki weighs survival and mechanics. Both get shown, and the gap is explained.
- Wiki content is CC BY-NC-SA 3.0: show the source link next to each section we render.

## 6. Open questions for the spec

- Item icons: source and licence (the OSRS Wiki serves item images; check its terms before bundling or hotlinking).
  **Answered 2026-11-18 (#10): the terms do not allow it. Tom accepted the risk, and the page shows icons (option B).**
  - Jagex holds the copyright of the item icons. The wiki uses them with Jagex's permission, and no Creative Commons licence covers them. Sources: the [Weird Gloop licensing page](https://meta.weirdgloop.org/w/Licensing) ("Non-text files" section) and the licence box on an item file page, for example [File:Abyssal whip.png](https://oldschool.runescape.wiki/w/File:Abyssal_whip.png). Crediting the wiki gives us no right to the images.
  - Jagex's [Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy) (version 1.4, 29 September 2026), clause 6.1.3, forbids Jagex Property in "companion, guide and other apps aimed at supporting or improving gameplay". The bank-mode page is such an app. Clause 6.1.3 makes one exception: modifications and plugins that are part of official programs (clause 4.1.6).
  - Other fan tools do the same. For example, oldschool.tools serves its own copies of the item icons. Jagex usually asks first, before it takes other action (clause 9.1). This is tolerance, not a licence.
  - **Decision (Tom, 2026-11-18): build ADR-3 as written, and accept the risk.** The UI server fetches each icon from the wiki on first use and keeps it in `~/.osrs-pvm-coach/icons/`. The page credits Jagex and the wiki. If Jagex objects, ADR-3's exit path ("show names only") still applies: the page already shows the name under each icon. To remove the risk, get a separate agreement with Jagex (clause 14.1; contact `IP@Jagex.com`, clause 16.1).
- Quest/unlock data for the Playbook's "unlocks you still need" (not exported today).
