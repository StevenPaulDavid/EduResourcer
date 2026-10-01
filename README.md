# EduResourcer

A standalone, local resource-allocation tool for schools. No server, no internet, no install:
open `index.html` in **Microsoft Edge or Google Chrome**, pick a data folder, and work.

## Getting started

1. Put this whole folder (`index.html`, `css/`, `js/`) somewhere shared, such as a OneDrive/SharePoint synced folder.
2. Open `index.html` (double-click it). First time on each computer, click **Choose data folder** and pick the
   folder you want to hold the data (it can be the same folder as `index.html`). The browser remembers it;
   if it asks for permission again later, click **Reconnect**.
3. The first person creates the **System admin** account and is shown a **recovery key**. Store that key offline.
4. Go to **Data** and import (CSV **or Excel .xlsx**; pick the worksheet if there are several. Old `.xls` files must
   be re-saved as .xlsx or CSV):
   - your class CSV (class name, day, period are needed; room, week A/B, teacher and **year group** are optional but
     recommended). If there is no year group column but names look like `9B/Maths`, the import can work the year out
     from the name. Year groups give you a filter and badge on the timetable and a **By year group** report.
     Classes can also carry a **Faculty** and **Subject** (the subject can be taken from `9B/Maths` style names), and
     resource files can carry a **Faculty**. These give Faculty/Subject filters on the timetable, a faculty filter on
     the resource bank and reports, and a **By subject / faculty** report that also totals the resources used.
   - one CSV **per resource type** (laptops, rooms, equipment…). Each type becomes a tab in the resource bank.
5. On **Allocate**, drag a resource from the bank at the bottom onto a class card. Click the × on a chip (or drag
   it back to the bank) to remove it. Drag a chip from one class to another to move it. You can also click a
   bank chip, then click classes to place it repeatedly (handy on touch screens).

**Help is built in.** Click **Help** in the top bar (or **Help** on the sign-in screen) for searchable guides
covering allocating, CSV formats, reports and printing, permissions, sharing, security and troubleshooting.
The **theme button** (◐ ☀ ☾) at the top right switches between Auto, Light and Dark. The choice is remembered
per browser, and printing is always in light colours.

`sample/` has example CSVs (including a messy-headers one to try the column-matching step).

## How it works

- **Allocations are recurring timetable slots** (e.g. 9B/Maths, Mon P2, Week A) and a resource can only be on one
  class per period/day/week. A class marked `AB` (or with a blank week) occupies both weeks.
- Re-importing classes keeps allocations on classes that still match on name + day + period + week. Anything that
  no longer matches is listed under **Data → Allocations to review**.
- **Roles**: System admin (everything, users), Resource admin (imports + allocate any class), Staff (allocate to
  classes where they are the teacher; link the login to the teacher name in **Users**), Read-only (view the
  timetable and run reports on screen only: no CSV export and no printing; those buttons are removed and the
  browser's own Print produces a blank page). This stops casual copying, not a determined person, since
  screenshots and copy/paste can't be blocked in a browser.
- **Print the whole timetable**: **Allocate → Print timetable…** prints every class in its Period × Day cell with
  its resources and year group badge, for Week A, Week B or both, either for everything or just the current filters
  (teacher/year/room/search), optionally with a separate page for each year group.
- **Auto-allocate** (System/Resource admins): build saved rules such as "Maths classes get Maths-faculty resources and
  laptops, Year 11 first, then Mr Adams, then Year 8" or "Year 11 get every device for English first, then Maths,
  then Science". A rule = which classes + which resources (the pool: type, owning faculty and/or items, combined
  with AND by default, e.g. Laptops AND Maths faculty = Maths-owned laptops, or switchable to OR) + an optional faculty limit + ordered priority
  steps (each a filter with a quantity and optional weekly maximum). **Preview** shows a per-step summary, the exact
  changes, unmet demand with reasons and a timetable preview; **Apply** makes the allocations (existing ones are
  kept) and every run can be **undone** from the run history. In the preview, lessons with no resource at all are
  red, and lessons that have some resource but are short of the rule are orange; **click any lesson** to see what is blocking it, remove a proposal, take a proposed resource from another class,
  or add any free resource by hand (tabs for resources in the pool and outside it) so every class is covered.
  Existing allocations can be removed there too (staged, applied with the run, restored by Undo), and a lesson
  covered only by an outside-the-pool resource shows orange.
  **Auto-fix** fills all the short lessons in one go (pool first, then outside it; same types as the pool by default),
  and can be undone.
- **Shared resources with priority** (admins set up, everyone sees): one resource (e.g. the Library Laptop Trolley)
  shared by groups such as IT, English, Music and Art, each defined by a class filter and a priority level (equal
  levels = shared, staff agree). Who has it in each lesson is worked out live from the timetable: best priority has it,
  others are flagged as missing out, equal levels show as shared, and a hand booking wins the lesson. There is a
  per-lesson timetable per resource, markers on the Allocate grid, and a separate printable/exportable report.
- **Clear allocations** (same admins): bulk-remove allocations by class (year, faculty, subject, teacher, room,
  named classes, day, period, week type), by resource (type, faculty, item) and by who made them (auto or hand).
  A live count and list show exactly what will go, clearing everything needs you to type CLEAR, and every clear can be
  **restored** from the run history.
- **Colours**: green ✓ = allocated, blue ⇄ = shared with an equal-priority group (staff talk), orange ✕ = shared
  resource this class can't have this lesson, red ⚠ = real clash. A key sits above the timetable; resource chips show
  their type with a small dot, and the bank is neutral.
- **Finding your place on the grid**: the timetable is a banded table with dark day headers and a period column.
  Hovering or dragging highlights the day, the period and the exact cell, and a banner at the bottom spells out
  what will happen ("Assign Projector P1 on 9B/Maths: Mon · Period 2 · Week A", or why it is blocked).
- **Reports**: by resource, class, room, teacher, plus a free-resources finder. Each has a **List** or **Timetable**
  layout. Timetable layouts show Period × Day grids for Week A and Week B, with resources as coloured tags.
  Choosing "All rooms/teachers/classes" (or all resources with bookings) makes one timetable per item. **Print**
  puts each on its own landscape A4 page (turn on "Background graphics" in the print dialog to keep the colours).
  Every report also exports to CSV.
- The screen auto-locks after 20 minutes idle and syncs other people's changes every 20 seconds (click "Synced" to refresh).

## Folder structure (inside the data folder)

```
Class_Data/        classes.edr                 (encrypted)
Resource_Data/     one file per resource type  (encrypted, opaque names)
Allocation_Data/   one file per allocation     (encrypted, opaque names)
Shared_Data/       shared-resource groups      (encrypted)
Rule_Data/         auto-allocate rules         (encrypted)
Run_Data/          auto-allocate run history   (encrypted)
Login_Data/        password hashes + wrapped keys, recovery file
```

## Security: what it does and doesn't do

- Passwords are never stored. Each login keeps a salted PBKDF2-SHA256 (310,000 rounds) verifier.
- All class, resource and allocation files are AES-256-GCM encrypted. File names are keyed hashes. Copying the
  folder gives an attacker only ciphertext.
- Each login holds its own copy of the data key, wrapped by that user's password, so an admin can reset someone's
  password without losing data. The recovery key can re-open the system if every admin password is lost.
- A strict Content-Security-Policy blocks all network access from the page.
- **Limit:** there is no server, so permissions are enforced by the app. Anyone with a valid login holds the data
  key, so a technically skilled insider could modify the app to bypass role checks. Treat roles as guard-rails for
  honest users, and use SharePoint folder permissions to control who can reach the folder at all.
- **If every admin password and the recovery key are lost, the data cannot be recovered.** That is the point.

## Limits to know about

- Chrome/Edge block picking some system folders (Desktop, Documents, Downloads) directly. Pick or create a subfolder.
- Two people booking the same resource for the same slot at the exact same moment on different computers can both
  succeed. The app detects it on the next sync, keeps the earlier booking and flags the later one in red.
- The "demo store" option on the welcome screen keeps data inside the browser only. It is for trying things out.
