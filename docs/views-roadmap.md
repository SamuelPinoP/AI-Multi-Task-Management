# Sidebar, Tree view and Mind view roadmap

Ideas and an action plan for making the sidebar more useful and for the two big planning views. Sizes: S (a day or less), M (a few days), L (a week or more). "Migration" means a Prisma schema change.

Suggested order: TREE-01, TREE-02 with TREE-03 (all done except TREE-03's keyboard part), MIND-01 and MIND-02, MIND-03, then the rest.

## Sidebar

### SIDE-01 Project pages in the sidebar (done)

Each project in the sidebar opens to Overview, Board and Chat, so the chat is one click away instead of Projects, then the project, then Open Chat.

- The project name still goes to the overview; the chevron on the right opens or closes the project.
- A project opens by itself while you're on one of its pages. Once you open or close it, that choice is kept in the `sidebar-projects` cookie, so the server renders it the same way after a reload.
- Chat shows how many messages are unread (SIDE-03, below); a closed project shows a dot instead. For a chat you've never opened, only messages from the last 14 days count.
- Opening and closing animates the height and respects reduced motion. Closed pages are `inert`, so the keyboard skips them.

### Ideas, in priority order

| ID | Idea | Size | Notes |
| --- | --- | --- | --- |
| SIDE-02 | **Chats hub** at `/chats`. Done: every project chat in one list, unread first, with the open chat beside it; search, an Unread filter and Mark all read; a "Chats" sidebar item with the number of chats that have new messages, and G then M. | S–M | Built with SIDE-03. |
| SIDE-03 | **Real unread counts on every device**. Done: the `ProjectChatRead (userId, projectId, lastReadAt)` table replaced `localStorage`; opening or posting in a chat marks it read, and a "New messages" line shows where you left off. | S | Migration `20261021150000_add_project_chat_read`. |
| SIDE-04 | **Favorites**: pin any project, note, tree page or saved filter to a group at the top of the sidebar; drag to reorder. | M | Migration (`Favorite` table). |
| SIDE-05 | **Views group** (decided against on October 24, 2026): Kanban, Tree, Mind, Timeline (today's Roadmap) and Calendar as sidebar items instead of tabs inside Boards. Tree pages list under Tree the way projects do. | S | Not building: it separates Kanban from Tasks and Calendar from Events, and adds a placeholder to the main navigation. Views stay as tabs on the page, as in Asana, Notion and Linear. |
| SIDE-06 | **Saved filters**: "Assigned to me", "High priority this week", "No due date", each with a count. | M | Migration (`SavedView`). |
| SIDE-07 | **Inbox** with a count (SMART-08). | M | Already planned. |
| SIDE-08 | **Goals** with a small weekly progress ring (SMART-04, `WeeklyGoal`). | M | Already planned. |
| SIDE-09 | **Focus timer** in the sidebar footer: start a Pomodoro on a task and log the time. Later feeds time blocking (SMART-06). | M | Migration (`TimeEntry`). |
| SIDE-10 | **Drop targets**: drag a task onto a sidebar project to move it, or onto My day to plan it for today. | M | Reuses the drag and drop library from TREE-02. |
| SIDE-11 | **More project pages**: Files (all chat attachments as a gallery), Calendar, Notes and Team as their own routes, then as sidebar sub-items. | M each | Today they're sections of the overview page. |
| SIDE-12 | **Customize the sidebar**: hide or reorder groups, choose how many projects show (today 8), sort projects by recent, name or by hand. | S–M | Cookie or a small `UserPreference` table. |

## Tree view: drag and drop

What exists: `src/components/tree-board.tsx` (1,244 lines) draws an org-chart style tree of cards with title, description, color and size, add child or sibling, delete, zoom and full screen. Tree pages are private per user. The API already moves nodes: `PATCH /api/tree-pages/[pageId]/nodes/[nodeId]` with `parentId` and `sortOrder` re-parents a node, refuses cycles and re-numbers the siblings in one transaction. Only the UI is missing.

### TREE-01 Prepare (done)

- `tree-board.tsx` is split into `src/components/tree/`: the board, node card, dialogs (on the shared `Dialog` and `ConfirmDialog`), page switcher, zoom controls, colors, types and pure layout helpers with unit tests (`tree-layout.test.ts`).
- The tree has its own routes, `/tree` and `/tree/[pageId]` (`src/lib/tree-pages.ts` loads them). Switching, creating and deleting pages updates the address without a reload. `/board?view=tree` redirects to `/tree`. Someone else's page is not found.
- Node colors are the `--tree-*` tokens in `globals.css` (white text passes 4.5:1 on each), and the canvas grid is `.tree-canvas`. `tests/e2e/tree.spec.ts` covers the routes, and the axe pass scans `/tree`.

### TREE-02 Drag to re-parent and reorder (done)

- `@dnd-kit/core` (MIT). Each card except the root has a grip handle; mouse, touch and keyboard (Space, arrow keys, Space) all drag, and screen readers hear the node titles.
- Drop zones: the left quarter of a card means "before", the right quarter "after" (a line beside the card), the middle "make it a child" (a ring around it). A drop on the root always makes a child.
- The whole subtree moves; the preview shows the title and how many nodes come along, and the subtree fades in place.
- Drops on the node's own subtree are refused on the client too, so nothing is sent.
- The tree changes at once and rolls back with a toast if the server refuses.
- The canvas scrolls near its edges (dnd-kit's auto-scroll). Zoom needs no modifier: the preview is drawn outside the scaled tree, and drop areas are measured on screen.
- Pure helpers with unit tests in `src/components/tree/tree-move.ts`: `dropZoneFor`, `isDescendant`, `moveFor`, `applyMove`.

### TREE-03 Keyboard and accessibility (S–M, part done)

- Done: a "Move to…" button on every card except the root opens a dialog with two lists, "Put it under" (every node outside its own subtree, indented by level) and "Position" (first, or after each other child). It makes the same moves as dragging, so moving never needs a drag (WCAG 2.5.7). The helpers are `moveParentOptions`, `movePositions` and `currentIndex` in `tree-move.ts`.
- Still to do: tree roles (`tree`, `treeitem`) and arrow keys between nodes; Enter edits, Tab adds a child, Shift+Enter adds a sibling, Alt+arrow keys move the node.
- Done: after a move, a toast offers Undo, and Ctrl+Z (Cmd+Z) undoes the last move unless the focus is in a text field.

### TREE-04 A better canvas (M, migration)

- Pan by dragging the background (or Space and drag), zoom toward the pointer, "Fit to screen" and a minimap.
- Fold a subtree: `TreeNode.collapsed Boolean @default(false)`.

### TREE-05 Outline mode (M, no migration)

The same tree as an indented list, best on phones. Drag to reorder with `@dnd-kit/sortable`; Tab and Shift+Tab indent and outdent.

### TREE-06 Connect the tree to real work (L, migration)

- Link a node to a task or a note (`TreeNode.taskId`, `TreeNode.noteId`) and show its status and due date on the card. "Convert to task" on any node.
- Tree pages per project (`TreePage.projectId`), shared with the project's members and listed under the project in the sidebar.

### TREE-07 Extras (M)

Select several nodes and move them together, copy and paste a subtree, export as a PNG or a Markdown outline.

### Testing

- Unit tests for the helpers above.
- End-to-end: drag with the keyboard (Space, arrow keys, Space), which is the most reliable in Playwright, then one mouse drag with `page.mouse`. Check the order after a reload.
- Add the tree route to the axe pass in `tests/e2e/accessibility.spec.ts`.

## Mind view: notes, tasks and more in 3D

Boards gets a Mind tab once the Mind view exists; there's no placeholder before then. The idea is a map of the whole workspace: projects, tasks, notes, events, tree pages and people as points, with lines for how they connect. 3D is the showpiece, but a 2D map and a list must come first: they work on every device and for screen readers, and the 3D view reuses the same data.

### MIND-01 Graph data (M, no migration)

- `src/lib/mind-graph.ts` builds `{ nodes, links }` from what already exists: a task, note or event belongs to a project, a task is assigned to a person, an event belongs to a project, a tree node links to a task or note (after TREE-06), and `[[links]]` between notes and tasks (after SMART-05).
- `GET /api/mind-graph` with filters: projects, types, date range, include done items. Cap it at about 1,000 nodes and say so when items are left out.
- Unit tests for the builder.

### MIND-02 2D map and list (M)

- A Mind route (`/mind`), with a Mind View tab on Boards next to Kanban and Tree. Load `react-force-graph-2d` (MIT) with `next/dynamic` and `ssr: false`, so its code loads only on this page.
- Color by project, a shape or icon per type, size by importance (open tasks, due soon). Projects pull their items into clusters.
- Click an item to open the existing task sheet, note editor or event sheet. Search, and filter chips by type and project.
- A "List" toggle shows the same graph as a grouped outline: the accessible version and the phone default.

### MIND-03 3D mode (M–L)

- A 2D/3D switch. 3D uses `react-force-graph-3d` (three.js, MIT): orbit, zoom, and the camera flies to the item you pick. Labels as sprites (`three-spritetext`).
- Layouts that make 3D worth it, not only pretty:
  - **Galaxy**: projects are suns and their tasks and notes orbit them; overdue items glow.
  - **Time axis**: depth is the due date, so you fly through the next weeks.
- Turn off auto-rotate when the user prefers reduced motion; stop drawing while the tab is hidden.
- Fall back to 2D without WebGL, and default to 2D on phones.
- three.js is large: keep it in this route's bundle only and check it with Lighthouse (TEST-06).

### MIND-04 Edit from the map (M, needs SMART-05 for links)

Drag a task onto a project to move it, Shift-drag from one item to another to link them, and quick add a task or note next to the selected item.

### MIND-05 Saved views (S, migration)

Save filters, layout and camera position per user (`MindView`).

### Testing

- Unit tests for the graph builder and the filters.
- End-to-end: the page loads, List mode shows the seeded items, and clicking one opens its sheet. Run axe on List mode. Don't assert on WebGL pixels: headless WebGL is unreliable.
