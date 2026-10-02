// In-app documentation. Shown as the "Help" page once signed in, and as a pop-up from the sign-in screens.
(function () {
  'use strict';
  const ER = (window.ER = window.ER || {});
  const HELP = (ER.help = {});
  const { h, clear } = ER.util;
  const U = ER.util;

  // ---------- tiny content helpers ----------
  // **bold** and `code` inside strings
  const rich = (s) => {
    const out = [];
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      const tok = m[0];
      out.push(tok.startsWith('**') ? h('strong', null, tok.slice(2, -2)) : h('code', null, tok.slice(1, -1)));
      last = m.index + tok.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const P = (s) => h('p', null, rich(s));
  const H = (s) => h('h4', null, s);
  const UL = (items) => h('ul', null, items.map((i) => h('li', null, rich(i))));
  const OL = (items) => h('ol', null, items.map((i) => h('li', null, rich(i))));
  const NOTE = (s, kind = '') => h('div', { class: 'help-note ' + kind }, rich(s));
  const TABLE = (cols, rows) => h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl help-tbl' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, rich(c))))))));
  const FAQ = (q, a) => h('details', { class: 'faq' }, h('summary', null, q), h('div', { class: 'faq-a' }, Array.isArray(a) ? a.map(P) : P(a)));

  const TICK = '✓', NO = '—';

  // ---------- the content ----------
  const SECTIONS = [
    {
      id: 'start', title: 'Quick start',
      body: () => [
        P('EduResourcer lets you assign shared resources (laptop trolleys, rooms, equipment…) to classes on a two-week (Week A / Week B) timetable. It runs from a single file, needs no server or internet, and keeps all of its data, encrypted, in one folder.'),
        H('Every time you use it'),
        OL([
          'Open `index.html` in **Microsoft Edge or Google Chrome**.',
          'The first time on a computer, click **Choose data folder** and pick the shared folder your school uses. Everyone must pick the **same** folder. If you see **Reconnect**, click it; your browser is just asking permission again.',
          'Sign in with your username and password. If an administrator gave you a temporary password you will be asked to choose your own.',
          'On **Allocate**, drag a resource from the bank at the bottom onto the class you want. It is saved straight away.',
        ]),
        H('Setting up a new system (System admin)'),
        OL([
          'Choose an empty folder and create the first System admin account.',
          '**Save the recovery key** that appears. It is shown once and is the only way back in if every admin password is lost.',
          'Go to **Data** and import your classes, then one CSV for each type of resource.',
          'Go to **Users** and add staff. Link each staff login to their teacher name so they can assign resources to their own classes.',
        ]),
      ],
    },
    {
      id: 'allocate', title: 'Allocating resources',
      body: () => [
        P('The **Allocate** page shows the timetable as a table: days across the top, periods down the side. Use the **Week A / Week B** switch to change fortnight. Classes that run every week carry an **A+B** badge and appear in both weeks.'),
        H('Assigning, moving and removing'),
        UL([
          '**Assign:** drag a chip from the resource bank onto a class card.',
          '**Remove:** click the **×** on the chip, or drag the chip back down onto the bank.',
          '**Move:** drag a chip from one class to another.',
          '**Click-to-place** (useful on touch screens): click a chip in the bank (it gets an outline), then click classes to assign it. Click the chip again or press **Done** to stop.',
        ]),
        H('Seeing where you are'),
        P('Hover or drag over the timetable and the day header, period label and the exact cell light up, with a faint tint along that row and column. While dragging, a banner at the bottom spells out what will happen, for example “Assign Projector P1 on 9B/Maths · Mon · Period 2 · Week A”. If the drop is not allowed the banner turns red and says why.'),
        H('What the colours mean'),
        P('One meaning per colour, with a symbol as well so it still reads in black and white (a key sits above the timetable):'),
        TABLE(['Colour', 'Meaning'], [
          ['**Green ✓**', 'Allocated: a hand-booked or auto-allocated resource, or a shared resource the class holds in that lesson. A small dot on the chip shows the resource type (the bank at the bottom is neutral grey with the same dots).'],
          ['**Blue ⇄**', 'A shared resource where another group has the **same priority** in that lesson: staff talk and agree between themselves.'],
          ['**Orange ✕**', 'A shared resource this class **cannot have this lesson** (a higher-priority group has it, or it is booked by hand for another class).'],
          ['**Red ⚠**', 'A real clash: the same resource double-booked for two classes in one lesson.'],
        ]),
        P('Cards that need a look get a coloured edge (red, then orange, then blue). Cards that are simply allocated keep a plain edge. The Shared page and the Auto-allocate preview use the same colours (in the preview, orange means short of the rule and red means no resource at all).'),
        H('Clashes'),
        P('A resource can only be on **one class at a time** in each period/day/week. Classes that cannot take the resource you are dragging are dimmed (hover one to read the reason). A class that runs in both weeks uses the resource in both.'),
        H('Finding classes'),
        UL([
          'Filter by **teacher**, **year group**, **faculty**, **subject** or **room**, or type in the search box. Choosing a faculty narrows the subject list.',
          'In the resource bank, the **faculty** drop-down shows only that faculty’s resources. It is independent of the timetable filters, so you can show Science classes and still see every faculty’s equipment. Resources with no faculty only appear under “All faculties”.',
          'The search box matches class names, rooms, teachers, year groups, faculties, subjects and the names of resources already assigned.',
          '**My classes** (shown when your login is linked to a teacher) hides everyone else’s. Your own classes always have a teal edge.',
        ]),
        H('The resource bank'),
        P('One tab per type (Laptops, Rooms, Equipment…). The small number on a chip is how many class slots currently use it. **Hide** collapses the bank for more room.'),
        H('Alerts'),
        UL([
          '**N allocations to review** (admins): an allocation points at a class or resource that is no longer in the imported lists. See the Data page.',
          '**N clashes:** two people booked the same resource for the same slot at the same moment. The earlier booking stands; the later one shows in red. Remove it with its ×.',
        ]),
        NOTE('Staff can only change classes where they are the teacher. Other classes show a plain background and cannot be dropped on. Read-only accounts cannot change anything.'),
      ],
    },
    {
      id: 'auto', title: 'Auto-allocate rules', who: 'Admins',
      body: () => [
        P('**Auto-allocate** hands out resources for you using rules you set once and can run again. Open it from the **Auto-allocate** tab. Nothing changes until you have previewed the result and pressed **Apply**, and every run can be undone.'),
        H('A rule has four parts'),
        OL([
          '**Which classes?** Filter by year group, faculty, subject, teacher, room, named classes, days, periods, and whether lessons run in Week A only, Week B only or every week. Leave a box empty for “any”.',
          '**The pool:** which resources can be handed out, chosen by type, owning faculty and/or individual items. By default a resource must match **all** the boxes you fill in, so type **Laptops** AND faculty **Maths** gives only Maths-owned laptops. Switch to “may match **any** box” if you want laptops **or** anything Maths owns. Within one box any choice counts (Laptops or Chromebooks). A live line under the boxes shows exactly which resources match.',
          '**Faculty limit** (optional): *only the class’s own faculty’s resources* (Maths classes get Maths resources), *only a faculty you choose*, or *prefer* the class’s own faculty but use others if they run out. Shared items with no faculty are used as a fallback unless you tick “strictly the faculty’s own items”.',
          '**Priority steps:** an ordered list. Each step is its own filter (any mix of year, subject, teacher, faculty, room or named classes) with how many resources each class gets, or “as many as are free”, and an optional maximum number of lessons per class per week. Use **Everyone else in scope** for the last step.',
        ]),
        H('How a run decides'),
        UL([
          '**Step 1 gets first pick of every lesson**, then step 2 gets what is left, and so on. This is how “Year 11 first, then Mr Adams gets the remainder, then Year 8” works.',
          'A class belongs to the **first step it matches**, so a Year 11 class taught by Mr Adams is dealt with in the Year 11 step.',
          'Within a step, lessons are filled earliest in the week first (Mon P1 before Fri P5); ties go by class name. The weekly maximum counts the lessons of one class (e.g. 9B/Maths) that week.',
          'A resource can only be in one place per lesson, so a class that runs in both weeks only receives an item that is free in both.',
          '**Existing allocations are kept** and count as taken. A class that already has what a step asks for is left alone, so running a rule again is safe.',
          'Where the pool mixes owners, the class’s own faculty’s items are tried first, then shared items. With **Prefer the same item** on (the default) a class keeps the same trolley or room each lesson where it can.',
          '**Keep spare** leaves that many pool items free in every lesson; whatever nobody is given stays in the resource bank.',
          'If fewer items are free than a step asks for, the class gets what is free and the preview says so.',
        ]),
        H('Preview, apply and undo'),
        P('**Preview & run** shows: a **Summary** per step (lessons, how many allocations, fully/part served, nothing free), the **Changes** it would make, **Unmet demand** with the reason for each (for example “every matching resource is already in use in that lesson”), and a **Timetable preview** where proposed resources appear as dashed tags. In the timetable preview, lessons that would have **no resource at all are red** (with a short reason; hover for the full one), lessons that are short of what the rule asks but **already have some resource are orange** (for example a class with a projector that the rule could not add a laptop to, or one that only got 1 of 2), lessons that are **covered only by a resource you added from outside the pool are also orange** (it is standing in for what the rule would have given), and lessons the rule does not cover are faded. **Apply** then makes the allocations (it re-checks them against the latest data first).'),
        H('Adjusting the preview by hand'),
        P('**Click any lesson** in the Timetable preview to adjust it before you apply. The panel shows what the lesson will get and, if it is short, **what is using the pool at that time** (which class holds each resource). From there you can:'),
        UL([
          '**Remove** a proposed resource from the lesson, or **Remove** an **existing** allocation (for example an outside-pool resource you want the rule’s one to replace). Removing an existing allocation is only staged: it is struck through, listed on the Changes tab, can be undone with **Keep it**, and only happens when you press **Apply**. Undoing the run puts it back.',
          '**Give to this lesson / Take it**: take a proposed resource from another class, or an already-allocated one (it is removed from that class when you apply). The class that loses one then shows as short.',
          '**Add a resource by hand**, in two tabs: **In the pool** lists pool resources that are free for the whole lesson (handy after you remove one, so you can see what is still available), and **Outside the pool** lists everything else that is free. This is how you make sure every class is covered when the pool is one short (7 resources, 8 classes). Both tabs are searchable tables with an **Add** button on each row.',
        ]),
        P('**Auto-fix short lessons…** (button above the tabs) does this for you in one go. It fills red lessons (or red and orange) from whatever is free: pool resources first, then resources outside the pool. By default it only uses the **same types as the pool**, so a laptop need is never filled with a projector, or you can choose specific types or any type. It can prefer (or require) the class’s own faculty’s resources. Nothing is final: review the result, adjust any lesson, or press **Undo auto-fix**. Lessons it cannot fill stay red.'),
        P('Everything updates straight away: red lessons turn normal when they are covered, the Summary, Changes and Unmet demand tabs recalculate, and a “changes by you” counter appears with a **Reset changes** button that re-runs the rule from scratch. Hand-added resources are marked ✎ and listed on the Changes tab; they are applied and undone together with the rest of the run and show “(auto: rule name, added by hand)” on hover. Resources already allocated before the run are fixed in the preview: change those on the Allocate screen, or use Undo / Clear allocations.'),
        P('Each run is recorded under **Run history**. **Undo** removes the allocations from that run that are still in place; any you have since moved or removed by hand are left alone. Allocations made by a rule show “(auto: rule name)” in the chip’s hover text.'),
        H('Clearing allocations'),
        P('Use **Clear allocations…** (top of the Auto-allocate page, or **Clear…** on the Allocate toolbar, which starts from your current filters) to remove allocations in bulk. Choose what to clear, and the count and a list of exactly what will go update as you pick:'),
        UL([
          '**By class:** year group, faculty, subject, teacher, room, named classes, days, periods, and Week A only / Week B only / every week lessons. Boxes work together (Subject: Maths **and** Day: Mon).',
          '**By resource:** types, resource faculty or individual items. Like the auto-allocate pool, resources must match all the boxes you fill in (Laptops AND Maths faculty), or you can switch to any box.',
          '**Made by:** any allocation, only those made by auto-allocate, or only those made by hand.',
          'Leave everything empty to clear **all** allocations (this also removes any whose class or resource has gone). That needs you to type CLEAR to confirm.',
        ]),
        P('Every clear is recorded in the Run history, and **Restore** puts the allocations back (with their original “allocated by”). A restore skips any that can no longer go back, for example because the resource has since been given to another class in that lesson.'),
        NOTE('Rules and run history are saved encrypted in the data folder (`Rule_Data` and `Run_Data`), so every admin sees the same rules.'),
      ],
    },
    {
      id: 'shared', title: 'Shared resources with priority',
      body: () => [
        P('Some resources are used by several groups, for example one Library Laptop Trolley wanted by IT, English, Music and Art. A **shared resource** is set up once with those groups and a **priority order**, and the system works out who has it in **each lesson**, live, from the timetable. Nothing is booked lesson by lesson and nobody has to press Apply: it updates itself when the timetable or priorities change.'),
        H('Setting it up (admins) on the Shared page'),
        OL([
          '**Add shared resource** and choose the resource (one item).',
          '**Add groups.** Each group has a name, a **priority** (1 is highest) and a class filter by subject, faculty, year group, teacher, room or named classes, for example IT = Subject: Computing. Every lesson of every class matching the filter counts. A class that matches several groups uses the best priority.',
          'Give two groups the **same priority number** (for example Music 3 and Art 3) if staff should share between them.',
        ]),
        H('How each lesson is decided'),
        UL([
          '**One class wanting it:** it **has it**.',
          '**Classes from different groups at the same time:** the best priority has it and the others **miss out**, flagged with the reason (for example “IT has priority”). No standing booking is kept for them.',
          '**Same priority, same lesson:** shown as **shared**, for staff to agree between themselves. Both stay listed, and the report puts them on a staff-to-agree list.',
          '**A hand booking** (dragging the resource onto a class the normal way) wins that lesson: that class has it and the shared groups lose that one lesson. You are warned which groups lose it before you confirm.',
        ]),
        H('Where you see it'),
        UL([
          '**Shared page → View timetable:** a grid for the resource showing, lesson by lesson, who has it (green), who shares it (blue) and who misses out (orange, with the reason). Everyone signed in can see it; only admins can change it.',
          '**Allocate grid:** classes in a group show a small marker on their card: “has it”, “shared with …” or “not this lesson (reason)”.',
          '**Reports → Shared resources:** groups and priorities, lessons wanted by more than one class, the staff-to-agree list, missed lessons by group, and free lessons. It can be printed or exported (not by Read-only accounts).',
          '**Auto-allocate** treats lessons where the groups hold the resource as in use, so it never gives the same resource to someone else then.',
        ]),
      ],
    },
    {
      id: 'prefs', title: 'Teacher preferences (usual resource)',
      body: () => [
        P('Some teachers always want the same resource, for example Mr K Mannion with Trolley A. Set it once on the **Preferences** page (admins add and edit; everyone can look) and every **Auto-allocate** run gives it to them **first**.'),
        H('Setting it up'),
        OL([
          '**Add preference**, choose the teacher (from your class data) and their **usual resource**. You can add more than one, in order: the second is used if the first is taken.',
          'Give each teacher a **rank**. If two teachers want the same resource in the same lesson, **rank 1 beats rank 2**. The page warns you when teachers who share a usual resource are timetabled at the same time.',
        ]),
        H('How a run uses it'),
        UL([
          'Before the rule’s steps run, each teacher (best rank first) gets their usual resource in every lesson in scope where it is free. The steps then fill whatever is left, so a usual resource counts towards what the step asks for.',
          'It is a **soft** preference. If the usual resource is taken (by a better-ranked teacher, an earlier booking, a shared-resource group) the teacher simply gets whatever the rule gives them. The preview lists who missed out and why on the **Summary** tab, and marks that lesson “↪ Not their usual resource” on the timetable preview.',
          'Only resources **in the rule’s pool** are used, so an Art rule never hands out a laptop trolley just because a teacher likes it. A usual resource ignores the rule’s faculty limit.',
          'A lesson that **already has a resource** keeps it; nothing existing is replaced.',
          'In the preview, proposed usual resources are marked ★ and “usual resource” on the Changes tab. You can still adjust any lesson by hand, and **Auto-fix** prefers a teacher’s usual resource when it has to pick.',
          'To switch it off for one rule, untick **Give teachers their usual resource first** in the rule’s faculty section.',
        ]),
        NOTE('Preferences are saved encrypted in the data folder (`Preference_Data`) and are shared by everyone.'),
      ],
    },
    {
      id: 'classes', title: 'Importing classes', who: 'Admins',
      body: () => [
        P('Go to **Data → Import classes** and choose or drag in a **CSV or Excel (.xlsx)** file. The first row must be the column headings. You do not need to rename your columns: the next step lets you match each field to a column in your file (it makes a good guess for you).'),
        NOTE('**Excel files:** if the workbook has several sheets, the import starts on the one with the most data and shows a **Worksheet** picker so you can choose another. Values are read as saved (formulas are not recalculated). Old `.xls` files are not supported: in Excel use Save As → Excel Workbook (`.xlsx`) or CSV. Workbooks over 25 MB are refused.'),
        TABLE(['Field', 'Needed?', 'What it accepts'], [
          ['Class name', 'Yes', 'Anything, e.g. `9B/Maths`.'],
          ['Day', 'Yes', '`Mon`, `Monday`, `Tue`, `Tues`… Numbers `1`–`5` mean Monday–Friday.'],
          ['Period', 'Yes', 'Anything: `1`, `P2`, `Reg`. Periods are sorted naturally (1, 2, 10).'],
          ['Week', 'No', '`A`, `B`, `Week A`, `1` or `2`. **Blank, `AB` or `Both` = every week.**'],
          ['Room', 'No', 'Anything. Used for the room filter and room reports.'],
          ['Teacher', 'No*', 'Anything, but it must be written **exactly the same** each time. *Needed if you want staff logins linked to their classes.'],
          ['Year group', 'No', '`9`, `Y9`, `Yr 9` or `Year 9` all become **Year 9**. Other text (e.g. `Reception`, `Sixth Form`) is kept as typed. Used for the year filter, badges and the By year group report.'],
        ]),
        TABLE(['Faculty / Subject', 'Needed?', 'What it accepts'], [
          ['Faculty', 'No', 'e.g. `Science`, `Humanities`. The department the class belongs to.'],
          ['Subject', 'No', 'e.g. `Biology`, `Maths`. Capitalisation and spacing are tidied so `maths` and `Maths` count as one.'],
        ]),
        P('Faculty and subject give you **Faculty** and **Subject** filters on the timetable and the **By subject / faculty** report. If you have no subject column but class names look like `9B/Maths`, the import can **take the subject from the class name** (the text after the slash).'),
        P('No year group column? If most class names start with the year number (like `9B/Maths` or `11C/Science`), the import offers to **work out the year group from the class name**. Tick or untick it in the preview and check the result before importing.'),
        P('A class is identified by its **name + day + period + week**. Two rows that match on all four are treated as duplicates and the second is skipped.'),
        H('Check before you import'),
        P('You will see how many rows are ready, how many have problems (with the row number and reason, e.g. “day ‘Funday’ is not recognised”), and how many are new, already there, or no longer in the file. Problem rows are skipped; fix them in your spreadsheet and import again.'),
        H('Importing again (new term or timetable change)'),
        P('Importing again replaces the class list. Resources stay on any class that still matches on name + day + period + week. Anything that no longer matches is kept but flagged under **Data → Allocations to review**, where you can remove it. Changing only the room, teacher or year group never loses an allocation.'),
      ],
    },
    {
      id: 'resources', title: 'Importing resources', who: 'Admins',
      body: () => [
        P('Each CSV or Excel file you import is **one type** of resource (all the laptop trolleys, all the rooms, all the equipment…) and becomes a tab in the resource bank. You can import as many types as you like.'),
        TABLE(['Field', 'Needed?', 'Notes'], [
          ['Name', 'Yes', 'What staff see on the chip, e.g. `Laptop Trolley 3`.'],
          ['ID / asset tag', 'Recommended', 'Used to recognise the same item on re-import, so renaming it does not lose its allocations. If blank, the name is used.'],
          ['Faculty', 'No', 'The faculty/department that owns the resource, e.g. `Science`. It lets you filter the resource bank and reports to one faculty’s resources.'],
          ['Location', 'No', 'Shown when you hover a chip, and in reports.'],
          ['Notes', 'No', 'Shown when you hover a chip.'],
        ]),
        P('Type the **type name** (e.g. “Laptops”) when importing. Using the name of an existing type **updates** that type. Items are matched by ID, so allocations are kept; items missing from the new file are flagged for review. Rooms you can book are simply a resource type called “Rooms”.'),
        P('To remove a whole type and all of its allocations, use **Delete** next to it on the Data page.'),
      ],
    },
    {
      id: 'reports', title: 'Reports and printing',
      body: () => [
        P('Open **Reports**. Choose a tab, pick what you want to look at, and switch between **List** and **Timetable** layouts.'),
        TABLE(['Report', 'What it shows'], [
          ['By resource', 'A usage summary (slots used / free, utilisation) for every resource, or every booking for one resource. You can narrow it by type and by the resource’s faculty. A shared resource is marked (shared), and the lessons the Shared page gives its groups (who holds it, who shares it) are counted and listed too. Every other report and timetable includes them as well.'],
          ['By class', 'Every class slot with its room, teacher and resources. Search by name, or show only classes with no resources.'],
          ['By year group', 'All classes in a year group (or every year group) with their resources. Needs year groups on the classes.'],
          ['By subject / faculty', 'Classes in a faculty or subject with their resources, plus a total of which resources those classes use and which faculty owns them. In the timetable layout you get one timetable per subject.'],
          ['By room', 'What is happening in a room and which resources are attached.'],
          ['By teacher', 'A teacher’s classes, rooms and resources.'],
          ['Free resources finder', 'Pick a day, period and week to see which resources are free and which classes are running then (classes with none are listed first).'],
        ]),
        H('Timetable layouts'),
        P('The **Timetable** layout shows Period × Day grids for Week A and Week B, with each resource as a coloured tag. Choosing “All rooms”, “All teachers” or “All classes” (or all resources with bookings) creates one timetable per item.'),
        H('Exporting and printing'),
        UL([
          '**Export CSV** saves the current report as a spreadsheet file.',
          '**Print** prints the current report. Timetables print as a simple spreadsheet-style grid on A4 portrait (blue day headers, P1–P5 down the side, class / room / teacher in each cell), one week per page, stretched to fill the page. A very busy timetable continues onto a second page. Set the browser’s print paper to A4 and margins to Default.',
          '**Allocate → Print timetable…** prints the whole school timetable (or just the current filters) for Week A, Week B or both, with every class, its year group badge (Y9) and its resources. Tick **Start a separate page for each year group** to get one set of pages per year.',
          'Printing is always in light colours, even in dark mode.',
        ]),
        NOTE('Read-only accounts can view reports on screen but cannot export or print.'),
      ],
    },
    {
      id: 'people', title: 'Accounts and permissions',
      body: () => [
        TABLE(['', 'System admin', 'Resource admin', 'Staff', 'Read-only'], [
          ['View the timetable and run reports', TICK, TICK, TICK, TICK],
          ['Assign / remove resources on their own classes', TICK, TICK, TICK, NO],
          ['Assign / remove resources on any class', TICK, TICK, NO, NO],
          ['Export CSV and print', TICK, TICK, TICK, NO],
          ['Import classes and resources, manage types, review allocations', TICK, TICK, NO, NO],
          ['Create and run Auto-allocate rules, clear allocations in bulk, undo/restore runs', TICK, TICK, NO, NO],
          ['Set up shared resources and priorities (everyone can view the result)', TICK, TICK, NO, NO],
          ['Manage users and the recovery key', TICK, NO, NO, NO],
        ]),
        H('Your own account'),
        P('Click your name at the top right to change your password. Use **Lock** to hide everything straight away (you will be locked automatically after 20 minutes of no activity).'),
        H('Managing users (System admin)'),
        UL([
          '**Users → Add user:** choose a username, role and a temporary password. They must choose their own at first sign-in.',
          '**Teacher name:** for Staff, enter the teacher name exactly as it appears in the class CSV. This is what lets them assign resources to their own classes.',
          '**Reset password:** gives them a new temporary password, which they must change at next sign-in. Their access to the data is kept.',
          'There must always be at least one System admin, and you cannot delete your own account.',
        ]),
      ],
    },
    {
      id: 'folder', title: 'The data folder and sharing',
      body: () => [
        P('Everything lives in the folder you chose. Inside it the system creates:'),
        TABLE(['Folder', 'Holds'], [
          ['`Class_Data`', 'The class list (encrypted).'],
          ['`Resource_Data`', 'One file per resource type (encrypted).'],
          ['`Allocation_Data`', 'One small file per allocation (encrypted).'],
          ['`Rule_Data`, `Run_Data`', 'Auto-allocate rules and run history (encrypted).'],
          ['`Shared_Data`', 'Shared-resource groups and priorities (encrypted).'],
          ['`Preference_Data`', 'Teachers’ usual resources and their rank (encrypted).'],
          ['`Login_Data`', 'Password hashes, wrapped keys and the recovery file.'],
        ]),
        H('Sharing through SharePoint / OneDrive'),
        UL([
          'Put the program files (`index.html`, `css`, `js`) and the data in a SharePoint library and sync it with OneDrive.',
          'Staff open `index.html` from their synced copy and, the first time, choose that same synced folder.',
          'Changes made by others appear within about 20 seconds. Click **Synced** in the top bar to check straight away.',
          'If two people assign the same resource to the same slot in the same moment, it is detected on the next sync and shown as a clash.',
        ]),
        H('Good to know'),
        UL([
          'Use Edge or Chrome. Browsers will not let you choose some system folders (such as Desktop or Documents itself); pick or create a sub-folder.',
          'To move the system, copy the whole folder, then choose the new location when prompted.',
          'Do not rename, edit or delete the data files by hand. They are unreadable by design.',
          'The **demo store** option on the welcome screen keeps data inside one browser only. It is just for trying things out.',
        ]),
      ],
    },
    {
      id: 'security', title: 'Security and recovery',
      body: () => [
        UL([
          'Passwords are never stored. Each login keeps a salted, deliberately slow hash used only to check it.',
          'All class, resource and allocation files are encrypted (AES-256) and have meaningless file names, so a copied folder is unreadable.',
          'The page cannot make any network connections. Nothing is sent anywhere.',
          'The screen locks after 20 minutes of inactivity, or when you press **Lock**.',
        ]),
        H('Forgotten passwords'),
        UL([
          '**Staff:** ask a System admin to reset your password.',
          '**System admin:** if another System admin can sign in, they can reset yours. If not, use the **recovery key**: on the sign-in screen choose “Forgot password? Use recovery key”, enter it, pick the admin account and set a new password.',
        ]),
        H('The recovery key'),
        P('It is created at set-up and shown once. Keep it offline (printed, or in a password manager), **not** in the data folder. A System admin can create a new one on the Users page, which permanently cancels the old one.'),
        NOTE('If every admin password **and** the recovery key are lost, the data cannot be recovered by anyone. That is what makes it secure.', 'warn'),
        H('Honest limits'),
        P('There is no server, so permissions are enforced by the program itself. Anyone with a valid login can open the data, so treat roles as guard-rails for honest users and use SharePoint folder permissions to control who can reach the folder at all. Read-only accounts cannot export or print, but screenshots and copy/paste cannot be blocked in a browser.'),
      ],
    },
    {
      id: 'appearance', title: 'Appearance and tips',
      body: () => [
        UL([
          '**Light / dark mode:** use the round theme button (◐ ☀ ☾) at the top right. It cycles **Auto** (follows your computer), **Light** and **Dark**. The choice is remembered on that computer and browser only.',
          'Press **Esc** to close a pop-up.',
          'The layout adapts to narrow windows and tablets.',
          'Class and resource names are searched as you type, so a few letters is enough.',
        ]),
      ],
    },
    {
      id: 'trouble', title: 'Troubleshooting',
      body: () => [
        FAQ('I can’t drop a resource on a class.', [
          'Dimmed classes cannot accept it. Hover one to read why. The usual reasons are:',
          'It is not your class (Staff can only change classes where they are the teacher); the resource is already on another class at that time; or your account is Read-only.',
        ]),
        FAQ('None of my classes are highlighted, or I can’t assign to any.', 'Your login is not linked to your teacher name, or it is spelled differently from the class CSV. Ask a System admin to check the “Teacher name” on your account (Users page).'),
        FAQ('It asks me to Reconnect.', 'Your browser forgot its permission to open the folder. Click **Reconnect** and allow access. Your data has not been affected.'),
        FAQ('The browser won’t let me choose my folder.', 'Chrome and Edge block certain system folders such as Desktop and Documents. Create a sub-folder inside it and choose that.'),
        FAQ('The top bar says “Sync problem”.', 'The folder could not be read, often because OneDrive is paused or you are offline. Fix that, then click the message to retry.'),
        FAQ('I see “allocations to review”.', 'After a re-import, some allocations no longer match any class or resource. Admins can see them on the Data page and remove them (or re-import a corrected file).'),
        FAQ('A resource chip is red with ⚠.', 'Two people booked it for the same slot at the same time. The earlier booking stands. Remove the red one with its ×.'),
        FAQ('My import says some rows have problems.', 'Those rows were skipped and the reason is shown next to the row number (for example an unrecognised day, a blank class name, or a duplicate). Fix them in your spreadsheet and import again.'),
        FAQ('Auto-allocate says “lessons in scope match none of the steps”, or allocates nothing.', [
          'The first message is a note, not an error: those lessons are inside the rule’s scope but no step covers them. Add a last step and tick **Everyone else in scope** to include them.',
          'If **nothing** is allocated, open the preview’s **Summary** and **Unmet demand** tabs. Check, in order: (1) **Lessons in scope** is more than 0; (2) each step’s **Lessons** column is more than 0, because a step with 0 matches a filter that finds nothing, such as a teacher or year group whose classes are not inside the scope you set (a class must match every box in “Which classes?”), or whose lessons an earlier step already took; (3) the **pool** has resources; (4) **Unmet demand** gives the reason per lesson, for example every matching resource is already in use in that lesson, a weekly limit, spare items being kept free, or a faculty limit with no matching resources.',
          'Also check **Resources per class** (at least 1) and that the pool boxes use values that exist (a resource’s faculty is set on the resource import, separate from a class’s faculty).',
        ]),
        FAQ('I was signed out.', 'The screen locks after 20 minutes without activity. Sign in again; nothing is lost.'),
        FAQ('The printed timetable is not filling the page.', 'In the browser’s print dialog choose paper size A4, orientation Portrait (it is set automatically in Edge and Chrome), margins Default and scale 100%.'),
        FAQ('Someone’s change isn’t showing for me.', 'Changes sync about every 20 seconds. Click **Synced** in the top bar to refresh now. If you use OneDrive, check it has finished syncing.'),
      ],
    },
  ];

  // ---------- rendering ----------
  HELP.render = (container, opts = {}) => {
    clear(container);
    const user = ER.auth && ER.auth.user();
    const sections = SECTIONS.map((s) => {
      const el = h('section', { class: 'help-sec', id: 'help-' + s.id },
        h('h3', null, s.title, s.who ? h('span', { class: 'help-who' }, s.who) : null), ...s.body());
      return { s, el, text: U.norm(s.title + ' ' + el.textContent) };
    });

    const toc = h('nav', { class: 'help-toc', 'aria-label': 'Help contents' });
    const body = h('div', { class: 'help-body' });
    const empty = h('p', { class: 'empty-note', hidden: true }, 'Nothing matches that search.');
    const tocLinks = new Map();
    for (const { s, el } of sections) {
      const a = h('button', { class: 'help-link', type: 'button', onclick: () => el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, s.title);
      tocLinks.set(s.id, a);
      toc.appendChild(a);
      body.appendChild(el);
    }
    body.appendChild(empty);

    const search = h('input', { type: 'search', placeholder: 'Search the help…', 'aria-label': 'Search the help',
      oninput: U.debounce((e) => {
        const q = U.norm(e.target.value);
        let any = false;
        for (const { s, el, text } of sections) {
          const show = !q || q.split(' ').every((w) => text.includes(w));
          el.hidden = !show;
          tocLinks.get(s.id).hidden = !show;
          if (show) any = true;
        }
        empty.hidden = any;
      }) });

    const head = h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Help'),
      h('p', { class: 'muted' }, user ? `Signed in as ${user.displayName} (${ER.auth.ROLES[user.role]}).` : 'Guides for using EduResourcer.')),
    h('div', { class: 'help-search' }, search));
    container.appendChild(h('div', { class: opts.modal ? 'help help-modal' : 'page help' }, head, h('div', { class: 'help-grid' }, toc, body)));
  };

  // pop-up version for the sign-in screens
  HELP.openModal = () => {
    const box = h('div');
    HELP.render(box, { modal: true });
    U.modal({ title: 'EduResourcer help', body: box, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
  };
})();
