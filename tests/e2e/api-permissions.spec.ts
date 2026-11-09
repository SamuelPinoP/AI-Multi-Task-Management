import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// Every project route checked as the project's Owner, an Admin, an Editor and
// a signed-in outsider (#385: everyone in a project edits; the owner and admins
// also manage members). Outsiders get 404 rather than 403 wherever the route
// would otherwise confirm that the project exists.

type Role = "owner" | "admin" | "editor" | "outsider";
const ROLES: Role[] = ["owner", "admin", "editor", "outsider"];

type Expected = Partial<Record<Role, number>>;

const api = {} as Record<Role, APIRequestContext>;
const emails = {} as Record<Role, string>;
const names = {} as Record<Role, string>;
const contexts: BrowserContext[] = [];

let projectId = "";
let projectName = "";
let ownerCommentId = "";
let attachmentId = "";
let projectTaskId = "";
let projectTaskTitle = "";
let editorMemberId = "";
let adminMemberId = "";
let ownerPersonalNoteId = "";

test.describe.configure({ mode: "serial" });

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `${response.url()} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

/** Calls the route as each role and checks every status, reporting all mismatches. */
async function expectStatuses(
  label: string,
  call: (client: APIRequestContext) => Promise<APIResponse>,
  expected: Expected,
) {
  for (const role of ROLES) {
    const want = expected[role];
    if (want === undefined) continue;
    const response = await call(api[role]);
    expect.soft(response.status(), `${label} as ${role}`).toBe(want);
  }
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);

  for (const role of ROLES) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    const { email, name } = await signUpAndLogIn(page, `E2E ${role}`);
    await page.close();
    api[role] = context.request;
    emails[role] = email;
    names[role] = name;
  }

  projectName = uniqueName("E2E permissions project");
  const project = await json<{ id: string }>(
    await api.owner.post("/api/projects", { data: { name: projectName } }),
  );
  projectId = project.id;

  for (const [role, memberRole] of [
    ["editor", "EDITOR"],
    ["admin", "ADMIN"],
  ] as const) {
    await json(
      await api.owner.post(`/api/projects/${projectId}/invitations`, {
        data: { email: emails[role], role: memberRole },
      }),
    );
    const invitations = await json<{ id: string; project: { id: string } }[]>(
      await api[role].get("/api/project-invitations"),
    );
    const invitation = invitations.find((item) => item.project.id === projectId);
    expect(invitation, `${role} sees the invitation`).toBeTruthy();
    await json(
      await api[role].patch(`/api/project-invitations/${invitation!.id}`, {
        data: { action: "ACCEPT" },
      }),
    );
  }

  const comment = await json<{ id: string; attachments: { id: string }[] }>(
    await api.owner.post(`/api/projects/${projectId}/comments`, {
      multipart: {
        message: "Owner message with a file",
        attachments: {
          name: "owner-notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Only project members may read this."),
        },
      },
    }),
  );
  ownerCommentId = comment.id;
  attachmentId = comment.attachments[0].id;

  projectTaskTitle = uniqueName("Owner project task");
  const task = await json<{ id: string }>(
    await api.owner.post("/api/tasks", {
      data: { title: projectTaskTitle, projectId },
    }),
  );
  projectTaskId = task.id;

  const details = await json<{
    members: { id: string; role: string; user: { email: string } | null }[];
  }>(await api.owner.get(`/api/projects/${projectId}`));
  const editor = details.members.find((member) => member.user?.email === emails.editor)!;
  const admin = details.members.find((member) => member.user?.email === emails.admin)!;
  expect(editor.role).toBe("EDITOR");
  expect(admin.role).toBe("ADMIN");
  editorMemberId = editor.id;
  adminMemberId = admin.id;

  const note = await json<{ id: string }>(
    await api.owner.post("/api/notes", {
      data: { title: "Owner personal note", content: "Not shared with anyone." },
    }),
  );
  ownerPersonalNoteId = note.id;
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
});

test("members can open the project; outsiders can't see it exists", async () => {
  await expectStatuses("GET project", (client) => client.get(`/api/projects/${projectId}`), {
    owner: 200,
    admin: 200,
    editor: 200,
    outsider: 404,
  });

  for (const role of ROLES) {
    const projects = await json<{ id: string }[]>(await api[role].get("/api/projects"));
    expect
      .soft(projects.some((project) => project.id === projectId), `project list as ${role}`)
      .toBe(role !== "outsider");

    const results = await json<{ projects: { id: string }[] }>(
      await api[role].get(`/api/search?q=${encodeURIComponent(projectName)}`),
    );
    expect
      .soft(results.projects.some((project) => project.id === projectId), `search as ${role}`)
      .toBe(role !== "outsider");

    // The owner's task in the shared project shows up in every member's search.
    const taskResults = await json<{ tasks: { id: string }[] }>(
      await api[role].get(`/api/search?q=${encodeURIComponent(projectTaskTitle)}`),
    );
    expect
      .soft(taskResults.tasks.some((task) => task.id === projectTaskId), `task search as ${role}`)
      .toBe(role !== "outsider");
  }
});

test("only the owner can rename or delete the project", async () => {
  await expectStatuses(
    "PATCH project",
    (client) => client.patch(`/api/projects/${projectId}`, { data: { name: projectName } }),
    { owner: 200, admin: 404, editor: 404, outsider: 404 },
  );
  await expectStatuses("DELETE project", (client) => client.delete(`/api/projects/${projectId}`), {
    admin: 404,
    editor: 404,
    outsider: 404,
  });
});

test("every member sets the project's priority (#361)", async () => {
  await expectStatuses(
    "PATCH project priority",
    (client) => client.patch(`/api/projects/${projectId}`, { data: { priority: "HIGH" } }),
    { owner: 200, admin: 200, editor: 200, outsider: 404 },
  );
  const project = await json<{ priority: string }>(await api.editor.get(`/api/projects/${projectId}`));
  expect(project.priority).toBe("HIGH");
  expect((await api.owner.patch(`/api/projects/${projectId}`, { data: { priority: "CRITICAL" } })).status()).toBe(400);
  // Renaming stays the owner's, even with a priority in the same request.
  expect((await api.editor.patch(`/api/projects/${projectId}`, { data: { name: "Renamed", priority: "LOW" } })).status()).toBe(404);
  expect((await api.admin.patch(`/api/projects/${projectId}`, { data: { name: "Renamed", priority: "LOW" } })).status()).toBe(404);
});

test("the owner and admins send and see invitations; editors don't (#385)", async () => {
  const ownerInvite = `e2e-pending-owner-${Date.now()}@example.test`;
  const adminInvite = `e2e-pending-admin-${Date.now()}@example.test`;
  const invitations = `/api/projects/${projectId}/invitations`;
  await expectStatuses(
    "POST invitation",
    (client) => client.post(invitations, { data: { email: client === api.admin ? adminInvite : ownerInvite, role: "EDITOR" } }),
    { owner: 201, admin: 201, editor: 404, outsider: 404 },
  );
  // Admin is a role an invitation can give; Viewer is gone.
  expect((await api.admin.post(invitations, { data: { email: `e2e-as-admin-${Date.now()}@example.test`, role: "ADMIN" } })).status()).toBe(201);
  expect((await api.owner.post(invitations, { data: { email: `e2e-as-viewer-${Date.now()}@example.test`, role: "VIEWER" } })).status()).toBe(400);
  await expectStatuses("GET invitations", (client) => client.get(invitations), {
    owner: 200,
    admin: 200,
    editor: 404,
    outsider: 404,
  });

  // Pending invitee emails stay with the people who manage members, even in the project details.
  for (const role of ["owner", "admin", "editor"] as const) {
    const details = await json<{ invitations: { invitedEmail: string }[] }>(
      await api[role].get(`/api/projects/${projectId}`),
    );
    for (const email of [ownerInvite, adminInvite]) {
      expect
        .soft(details.invitations.some((invitation) => invitation.invitedEmail === email), `${email} as ${role}`)
        .toBe(role !== "editor");
    }

    // The project page no longer lists invitations (#384), so it carries no invitee emails at all.
    const page = await api[role].get(`/projects/${projectId}`);
    expect(page.ok()).toBe(true);
    expect.soft((await page.text()).includes(ownerInvite), `project page as ${role}`).toBe(false);
  }
});

test("the owner and admins manage members; only the owner dismisses or removes an admin (#385)", async () => {
  const members = `/api/projects/${projectId}/members`;
  await expectStatuses(
    "POST member",
    (client) => client.post(members, { data: { name: "Placeholder teammate", role: "EDITOR" } }),
    { owner: 201, admin: 201, editor: 403, outsider: 403 },
  );
  expect((await api.owner.post(members, { data: { name: "Old role", role: "VIEWER" } })).status()).toBe(400);

  await expectStatuses(
    "PATCH member role",
    (client) => client.patch(`${members}/${editorMemberId}`, { data: { role: "EDITOR" } }),
    { editor: 403, outsider: 403 },
  );
  await expectStatuses(
    "DELETE member",
    (client) => client.delete(`${members}/${editorMemberId}`),
    { editor: 403, outsider: 403 },
  );
  await expectStatuses("PATCH member role to Viewer", (client) => client.patch(`${members}/${editorMemberId}`, { data: { role: "VIEWER" } }), {
    owner: 400,
    admin: 400,
  });
  // Nobody changes their own role or removes themselves here.
  expect((await api.admin.patch(`${members}/${adminMemberId}`, { data: { role: "EDITOR" } })).status()).toBe(400);
  expect((await api.admin.delete(`${members}/${adminMemberId}`)).status()).toBe(400);

  // An admin makes a member an admin, but can't dismiss or remove that admin again.
  const { member: helper } = await json<{ member: { id: string } }>(
    await api.owner.post(members, { data: { name: "Helper", role: "EDITOR" } }),
  );
  const role = (value: string) => ({ data: { role: value } });
  expect((await json<{ role: string }>(await api.admin.patch(`${members}/${helper.id}`, role("ADMIN")))).role).toBe("ADMIN");
  expect((await api.admin.patch(`${members}/${helper.id}`, role("EDITOR"))).status()).toBe(403);
  expect((await api.admin.delete(`${members}/${helper.id}`)).status()).toBe(403);

  // The owner dismisses that admin; then the admin can remove the member.
  expect((await json<{ role: string }>(await api.owner.patch(`${members}/${helper.id}`, role("EDITOR")))).role).toBe("EDITOR");
  expect((await api.admin.delete(`${members}/${helper.id}`)).status()).toBe(200);

  // The owner also removes admins.
  const { member: second } = await json<{ member: { id: string } }>(
    await api.owner.post(members, { data: { name: "Second admin", role: "ADMIN" } }),
  );
  expect((await api.admin.delete(`${members}/${second.id}`)).status()).toBe(403);
  expect((await api.owner.delete(`${members}/${second.id}`)).status()).toBe(200);
});

test("every member posts in the chat; outsiders get nothing", async () => {
  await expectStatuses("GET comments", (client) => client.get(`/api/projects/${projectId}/comments`), {
    owner: 200,
    admin: 200,
    editor: 200,
    outsider: 404,
  });
  await expectStatuses(
    "POST comment",
    (client) => client.post(`/api/projects/${projectId}/comments`, { data: { message: "Hello team" } }),
    { owner: 201, admin: 201, editor: 201, outsider: 404 },
  );
  await expectStatuses(
    "PATCH someone else's comment",
    (client) =>
      client.patch(`/api/projects/${projectId}/comments/${ownerCommentId}`, {
        data: { message: "Rewritten" },
      }),
    { admin: 403, editor: 403, outsider: 404 },
  );
  await expectStatuses(
    "DELETE someone else's comment",
    (client) => client.delete(`/api/projects/${projectId}/comments/${ownerCommentId}`),
    { admin: 403, editor: 403, outsider: 404 },
  );
  await expectStatuses(
    "POST upload plan",
    (client) =>
      client.post(`/api/projects/${projectId}/attachments/uploads`, {
        data: { files: [{ clientId: "plan-check", name: "plan.txt", size: 12, type: "text/plain" }] },
      }),
    { owner: 200, admin: 200, editor: 200, outsider: 404 },
  );
  await expectStatuses(
    "GET attachment",
    (client) => client.get(`/api/projects/${projectId}/attachments/${attachmentId}/download`),
    { owner: 200, admin: 200, editor: 200, outsider: 404 },
  );
  await expectStatuses(
    "GET attachment preview",
    (client) => client.get(`/api/projects/${projectId}/attachments/${attachmentId}/preview`),
    // A text file has no Word preview; outsiders must not learn even that.
    { owner: 415, admin: 415, editor: 415, outsider: 404 },
  );
});

test("every member manages project labels; outsiders see nothing (#276)", async () => {
  const labelName = uniqueName("Label");
  await expectStatuses(
    "POST project label",
    (client) => client.post("/api/labels", { data: { name: `${labelName} ${client === api.owner ? "o" : "x"}`, projectId } }),
    { owner: 201, admin: 201, outsider: 404 },
  );
  const label = await json<{ id: string; name: string; projectId: string }>(
    await api.editor.post("/api/labels", { data: { name: labelName, projectId, color: "#2563eb" } }),
  );
  expect(label.projectId).toBe(projectId);
  // The same name again, in any case, is the same label.
  const again = await api.owner.post("/api/labels", { data: { name: labelName.toUpperCase(), projectId } });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { label: { id: string } }).label.id).toBe(label.id);

  await expectStatuses("GET project labels", (client) => client.get(`/api/labels?project=${projectId}`), {
    owner: 200,
    admin: 200,
    editor: 200,
    outsider: 404,
  });
  const outsiderLabels = await json<{ id: string }[]>(await api.outsider.get("/api/labels"));
  expect(outsiderLabels.some((item) => item.id === label.id)).toBe(false);
  await expectStatuses(
    "PATCH project label",
    (client) => client.patch(`/api/labels/${label.id}`, { data: { color: "#7c3aed" } }),
    { admin: 200, editor: 200, outsider: 404 },
  );

  // A project task takes the project's labels, never someone's personal ones.
  const personal = await json<{ id: string }>(await api.owner.post("/api/labels", { data: { name: uniqueName("Personal") } }));
  const refused = await api.owner.post("/api/tasks", { data: { title: "Labeled", projectId, labelIds: [personal.id] } });
  expect(refused.status()).toBe(400);
  const task = await json<{ id: string; labels: { label: { id: string } }[] }>(
    await api.editor.post("/api/tasks", { data: { title: uniqueName("Labeled task"), projectId, labelIds: [label.id] } }),
  );
  expect(task.labels.map((row) => row.label.id)).toEqual([label.id]);

  // Deleting the label takes it off the task; the task stays.
  await expectStatuses("DELETE project label", (client) => client.delete(`/api/labels/${label.id}`), {
    outsider: 404,
  });
  expect((await api.editor.delete(`/api/labels/${label.id}`)).status()).toBe(200);
  const tasks = await json<{ id: string; labels: unknown[] }[]>(await api.owner.get("/api/tasks"));
  expect(tasks.find((item) => item.id === task.id)?.labels).toEqual([]);
});

test("bulk changes are all or nothing, with the same rules as one task (#281)", async () => {
  const bulk = (ids: string[], change: Record<string, unknown>) => ({ data: { ids, change } });
  await expectStatuses(
    "PATCH bulk project task",
    (client) => client.patch("/api/tasks/bulk", bulk([projectTaskId], { priority: "LOW" })),
    { owner: 200, admin: 200, editor: 200, outsider: 404 },
  );
  // The owner's personal task is invisible to the editor, so the whole request fails and nothing changes.
  const personal = await json<{ id: string }>(await api.owner.post("/api/tasks", { data: { title: uniqueName("Owner personal") } }));
  const mixed = await api.editor.patch("/api/tasks/bulk", bulk([projectTaskId, personal.id], { priority: "URGENT" }));
  expect(mixed.status()).toBe(404);
  const tasks = await json<{ id: string; priority: string }[]>(await api.owner.get("/api/tasks"));
  expect(tasks.find((task) => task.id === projectTaskId)?.priority).toBe("LOW");
  expect(tasks.find((task) => task.id === personal.id)?.priority).toBe("NONE");
  // A bad change is refused before anything is read.
  expect((await api.owner.patch("/api/tasks/bulk", bulk([projectTaskId], { priority: "CRITICAL" }))).status()).toBe(400);
  await expectStatuses(
    "DELETE bulk project task",
    (client) => client.delete("/api/tasks/bulk", { data: { ids: [projectTaskId] } }),
    { outsider: 404 },
  );
});

test("comments: every member writes, outsiders see nothing (#279)", async () => {
  const task = await json<{ id: string }>(await api.owner.post("/api/tasks", { data: { title: uniqueName("Commented task"), projectId } }));
  const comments = `/api/tasks/${task.id}/comments`;
  await expectStatuses("POST comment", (client) => client.post(comments, { data: { body: "Hello" } }), {
    owner: 201,
    admin: 201,
    editor: 201,
    outsider: 404,
  });
  await expectStatuses("GET activity", (client) => client.get(`/api/tasks/${task.id}/activity`), {
    owner: 200,
    admin: 200,
    editor: 200,
    outsider: 404,
  });
  const activity = await json<{ comments: { id: string; mine: boolean }[]; events: { kind: string }[]; canComment: boolean }>(
    await api.editor.get(`/api/tasks/${task.id}/activity`),
  );
  expect(activity.comments).toHaveLength(3);
  expect(activity.canComment).toBe(true);
  expect(activity.events.map((event) => event.kind)).toContain("CREATED");

  // Only the author edits or deletes a comment.
  const ownerComment = activity.comments[0].id;
  await expectStatuses("PATCH comment", (client) => client.patch(`${comments}/${ownerComment}`, { data: { body: "Edited" } }), {
    admin: 403,
    editor: 403,
    outsider: 404,
    owner: 200,
  });
  await expectStatuses("DELETE comment", (client) => client.delete(`${comments}/${ownerComment}`), { admin: 403, editor: 403, outsider: 404 });
  expect((await api.owner.post(comments, { data: { body: "   " } })).status()).toBe(400);
});

test("every member changes project tasks; outsiders can't", async () => {
  await expectStatuses(
    "POST project task",
    (client) => client.post("/api/tasks", { data: { title: "New project task", projectId } }),
    { owner: 201, admin: 201, editor: 201, outsider: 400 },
  );
  // PATCH replaces the whole task, so it sends every field. Naming a project
  // the caller can't access is "Invalid project", without saying whether it exists.
  const taskUpdate = { title: "Owner project task", status: "TODO", priority: "MEDIUM", recurrence: "NONE", projectId };
  await expectStatuses(
    "PATCH project task",
    (client) => client.patch(`/api/tasks/${projectTaskId}`, { data: taskUpdate }),
    { owner: 200, admin: 200, editor: 200, outsider: 400 },
  );
  await expectStatuses(
    "PATCH project task without naming the project",
    (client) => client.patch(`/api/tasks/${projectTaskId}`, { data: { ...taskUpdate, projectId: undefined } }),
    { outsider: 404 },
  );
  await expectStatuses("DELETE project task", (client) => client.delete(`/api/tasks/${projectTaskId}`), {
    outsider: 404,
  });

  for (const role of ROLES) {
    const tasks = await json<{ id: string }[]>(await api[role].get("/api/tasks"));
    expect
      .soft(tasks.some((task) => task.id === projectTaskId), `task list as ${role}`)
      .toBe(role !== "outsider");
  }
});

test("subtasks and dependencies follow the same rules as editing tasks", async () => {
  const other = await json<{ id: string }>(await api.owner.post("/api/tasks", { data: { title: "Other project task", projectId } }));
  await expectStatuses(
    "POST subtask",
    (client) => client.post("/api/tasks", { data: { title: "Subtask", parentId: projectTaskId } }),
    { owner: 201, admin: 201, editor: 201, outsider: 400 },
  );
  await expectStatuses(
    "POST dependency",
    (client) => client.post(`/api/tasks/${other.id}/dependencies`, { data: { blockedById: projectTaskId } }),
    { owner: 201, admin: 201, editor: 201, outsider: 404 },
  );
  await expectStatuses(
    "DELETE dependency",
    (client) => client.delete(`/api/tasks/${other.id}/dependencies/${projectTaskId}`),
    { outsider: 404, editor: 200 },
  );
  // An outsider's own task can't wait on a project task they can't see.
  const outsiderTask = await json<{ id: string }>(await api.outsider.post("/api/tasks", { data: { title: "Outsider task" } }));
  await expectStatuses(
    "POST dependency on an unseen task",
    (client) => client.post(`/api/tasks/${outsiderTask.id}/dependencies`, { data: { blockedById: projectTaskId } }),
    { outsider: 400 },
  );
});

test("goals are personal; linking a task needs edit rights on it", async () => {
  const goal = await json<{ id: string }>(await api.owner.post("/api/goals", { data: { title: "Owner goal", targetWeek: "2026-W43" } }));
  await expectStatuses(
    "PATCH someone else's goal",
    (client) => client.patch(`/api/goals/${goal.id}`, { data: { status: "COMPLETED" } }),
    { owner: 200, admin: 404, editor: 404, outsider: 404 },
  );
  await expectStatuses(
    "link a project task to your own goal",
    async (client) => {
      const own = await json<{ id: string }>(await client.post("/api/goals", { data: { title: "My goal", targetWeek: "2026-W43" } }));
      return client.post(`/api/goals/${own.id}/tasks`, { data: { taskId: projectTaskId } });
    },
    { owner: 200, admin: 200, editor: 200, outsider: 404 },
  );
});

test("note links follow note access; attaching an event needs edit rights", async () => {
  const projectNote = await json<{ id: string }>(
    await api.owner.post("/api/notes", { data: { title: "Project note", content: "See [[Other]]", projectId } }),
  );
  await expectStatuses("GET project note links", (client) => client.get(`/api/notes/${projectNote.id}/links`), {
    owner: 200,
    admin: 200,
    editor: 200,
    outsider: 404,
  });
  await expectStatuses("GET personal note links", (client) => client.get(`/api/notes/${ownerPersonalNoteId}/links`), {
    owner: 200,
    admin: 404,
    editor: 404,
    outsider: 404,
  });
  await expectStatuses("PUT note event", (client) => client.put(`/api/notes/${projectNote.id}/event`, { data: { eventId: null } }), {
    owner: 200,
    admin: 200,
    editor: 200,
    outsider: 404,
  });
  await expectStatuses(
    "POST task from someone else's personal note",
    (client) => client.post("/api/tasks", { data: { title: "From a note", noteId: ownerPersonalNoteId } }),
    { admin: 400, editor: 400, outsider: 400 },
  );
});

test("personal notes stay private, even to teammates", async () => {
  await expectStatuses(
    "PATCH personal note",
    (client) =>
      client.patch(`/api/notes/${ownerPersonalNoteId}`, {
        data: { title: "Owner personal note", content: "Changed" },
      }),
    { owner: 200, admin: 404, editor: 404, outsider: 404 },
  );
  await expectStatuses("DELETE personal note", (client) => client.delete(`/api/notes/${ownerPersonalNoteId}`), {
    admin: 404,
    editor: 404,
    outsider: 404,
  });
});

test("whoever can edit the project can restore a teammate's deleted task", async () => {
  type TrashList = { tasks: { id: string; deletedByName: string | null; projectName: string | null; ownedByYou: boolean }[] };
  const trashedTask = async (role: Role) =>
    (await json<TrashList>(await api[role].get("/api/trash"))).tasks.find((task) => task.id === taskId);
  const restore = (client: APIRequestContext) => client.patch("/api/trash", { data: { type: "task", id: taskId } });

  const { id: taskId } = await json<{ id: string }>(
    await api.owner.post("/api/tasks", { data: { title: uniqueName("Task the editor deletes"), projectId } }),
  );
  await json(await api.editor.delete(`/api/tasks/${taskId}`));

  // Every member sees it in their trash, with who deleted it; outsiders don't.
  expect(await trashedTask("owner")).toMatchObject({ deletedByName: names.editor, projectName, ownedByYou: true });
  expect(await trashedTask("admin")).toMatchObject({ deletedByName: names.editor, projectName, ownedByYou: false });
  expect(await trashedTask("editor")).toMatchObject({ deletedByName: null, projectName, ownedByYou: false });
  expect(await trashedTask("outsider")).toBeUndefined();

  await expectStatuses("restore a teammate's task", restore, { outsider: 404 });
  expect((await api.editor.patch("/api/trash", { data: { type: "project", id: taskId } })).status()).toBe(400);

  // Emptying the editor's trash leaves the owner's task alone.
  await json(await api.editor.delete("/api/trash"));
  expect(await trashedTask("editor")).toBeTruthy();

  await expectStatuses("restore a teammate's task", restore, { editor: 200 });
  expect(await trashedTask("owner")).toBeUndefined();
  const tasks = await json<{ id: string }[]>(await api.owner.get("/api/tasks"));
  expect(tasks.some((task) => task.id === taskId)).toBe(true);
});

test("only the owner links GitHub", async () => {
  const github = `/api/projects/${projectId}/github`;
  await expectStatuses("PUT GitHub repository", (client) => client.put(github, { data: { repo: "ai-multi-demo/roadmap" } }), {
    admin: 403,
    editor: 403,
    outsider: 404,
    owner: 200,
  });
  await expectStatuses("GET GitHub panel", (client) => client.get(github), { owner: 200, admin: 200, editor: 200, outsider: 404 });
  await expectStatuses("DELETE GitHub repository", (client) => client.delete(github), { admin: 403, editor: 403, outsider: 404, owner: 200 });
});

test("signed-out requests are rejected", async ({ baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL });
  const calls: [string, () => Promise<APIResponse>][] = [
    ["GET /api/projects", () => anonymous.get("/api/projects")],
    ["GET project", () => anonymous.get(`/api/projects/${projectId}`)],
    ["PATCH project", () => anonymous.patch(`/api/projects/${projectId}`, { data: { name: "x" } })],
    ["DELETE project", () => anonymous.delete(`/api/projects/${projectId}`)],
    ["POST comment", () => anonymous.post(`/api/projects/${projectId}/comments`, { data: { message: "x" } })],
    ["GET attachment", () => anonymous.get(`/api/projects/${projectId}/attachments/${attachmentId}/download`)],
    ["GET invitations", () => anonymous.get(`/api/projects/${projectId}/invitations`)],
    ["POST member", () => anonymous.post(`/api/projects/${projectId}/members`, { data: { name: "x", role: "EDITOR" } })],
    ["PATCH member", () => anonymous.patch(`/api/projects/${projectId}/members/${editorMemberId}`, { data: { role: "ADMIN" } })],
    ["DELETE member", () => anonymous.delete(`/api/projects/${projectId}/members/${editorMemberId}`)],
    ["PUT GitHub repository", () => anonymous.put(`/api/projects/${projectId}/github`, { data: { repo: "a/b" } })],
    ["GET tasks", () => anonymous.get("/api/tasks")],
    ["PATCH task", () => anonymous.patch(`/api/tasks/${projectTaskId}`, { data: { title: "x" } })],
    ["GET notes", () => anonymous.get("/api/notes")],
    ["GET events", () => anonymous.get("/api/events")],
    ["GET search", () => anonymous.get("/api/search?q=x")],
    ["GET trash", () => anonymous.get("/api/trash")],
    ["PATCH trash", () => anonymous.patch("/api/trash", { data: { type: "task", id: projectTaskId } })],
    ["GET my invitations", () => anonymous.get("/api/project-invitations")],
  ];

  for (const [label, call] of calls) {
    expect.soft((await call()).status(), label).toBe(401);
  }
  await anonymous.dispose();
});
