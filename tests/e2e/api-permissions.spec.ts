import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
} from "@playwright/test";
import { signUpAndLogIn, uniqueName } from "./helpers";

// Every project route checked as the project's Owner, an Editor, a Viewer and
// a signed-in outsider. Outsiders get 404 rather than 403 wherever the route
// would otherwise confirm that the project exists.

type Role = "owner" | "editor" | "viewer" | "outsider";
const ROLES: Role[] = ["owner", "editor", "viewer", "outsider"];

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
let viewerMemberId = "";
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
    ["viewer", "VIEWER"],
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
    members: { id: string; user: { email: string } | null }[];
  }>(await api.owner.get(`/api/projects/${projectId}`));
  editorMemberId = details.members.find((member) => member.user?.email === emails.editor)!.id;
  viewerMemberId = details.members.find((member) => member.user?.email === emails.viewer)!.id;

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
    editor: 200,
    viewer: 200,
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
    { owner: 200, editor: 404, viewer: 404, outsider: 404 },
  );
  await expectStatuses("DELETE project", (client) => client.delete(`/api/projects/${projectId}`), {
    editor: 404,
    viewer: 404,
    outsider: 404,
  });
});

test("only the owner sees and sends invitations", async () => {
  const pendingEmail = `e2e-pending-${Date.now()}@example.test`;
  await expectStatuses(
    "POST invitation",
    (client) =>
      client.post(`/api/projects/${projectId}/invitations`, {
        data: { email: pendingEmail, role: "VIEWER" },
      }),
    { editor: 404, viewer: 404, outsider: 404, owner: 201 },
  );
  await expectStatuses("GET invitations", (client) => client.get(`/api/projects/${projectId}/invitations`), {
    owner: 200,
    editor: 404,
    viewer: 404,
    outsider: 404,
  });

  // Pending invitee emails stay with the owner, even in the project details.
  for (const role of ["owner", "editor", "viewer"] as const) {
    const details = await json<{ invitations: { invitedEmail: string }[] }>(
      await api[role].get(`/api/projects/${projectId}`),
    );
    expect
      .soft(details.invitations.some((invitation) => invitation.invitedEmail === pendingEmail), `invitations as ${role}`)
      .toBe(role === "owner");

    // The server-rendered project page must not carry them either.
    const page = await api[role].get(`/projects/${projectId}`);
    expect(page.ok()).toBe(true);
    expect.soft((await page.text()).includes(pendingEmail), `project page as ${role}`).toBe(role === "owner");
  }
});

test("only the owner manages members", async () => {
  await expectStatuses(
    "POST member",
    (client) =>
      client.post(`/api/projects/${projectId}/members`, {
        data: { name: "Placeholder teammate", role: "VIEWER" },
      }),
    { editor: 403, viewer: 403, outsider: 403, owner: 201 },
  );
  await expectStatuses(
    "PATCH member role",
    (client) =>
      client.patch(`/api/projects/${projectId}/members/${viewerMemberId}`, {
        data: { role: "EDITOR" },
      }),
    { editor: 403, viewer: 403, outsider: 403 },
  );
  await expectStatuses(
    "DELETE member",
    (client) => client.delete(`/api/projects/${projectId}/members/${editorMemberId}`),
    { editor: 403, viewer: 403, outsider: 403 },
  );
  await expectStatuses(
    "POST member note",
    (client) =>
      client.post(`/api/projects/${projectId}/members/${editorMemberId}/notes`, {
        data: { message: "Checked in on progress." },
      }),
    { owner: 201, editor: 201, viewer: 403, outsider: 404 },
  );
});

test("editors post in the chat, viewers read it, outsiders get nothing", async () => {
  await expectStatuses("GET comments", (client) => client.get(`/api/projects/${projectId}/comments`), {
    owner: 200,
    editor: 200,
    viewer: 200,
    outsider: 404,
  });
  await expectStatuses(
    "POST comment",
    (client) => client.post(`/api/projects/${projectId}/comments`, { data: { message: "Hello team" } }),
    { owner: 201, editor: 201, viewer: 403, outsider: 404 },
  );
  await expectStatuses(
    "PATCH someone else's comment",
    (client) =>
      client.patch(`/api/projects/${projectId}/comments/${ownerCommentId}`, {
        data: { message: "Rewritten" },
      }),
    { editor: 403, viewer: 403, outsider: 404 },
  );
  await expectStatuses(
    "DELETE someone else's comment",
    (client) => client.delete(`/api/projects/${projectId}/comments/${ownerCommentId}`),
    { editor: 403, viewer: 403, outsider: 404 },
  );
  await expectStatuses(
    "POST upload plan",
    (client) =>
      client.post(`/api/projects/${projectId}/attachments/uploads`, {
        data: { files: [{ clientId: "plan-check", name: "plan.txt", size: 12, type: "text/plain" }] },
      }),
    { owner: 200, editor: 200, viewer: 403, outsider: 404 },
  );
  await expectStatuses(
    "GET attachment",
    (client) => client.get(`/api/projects/${projectId}/attachments/${attachmentId}/download`),
    { owner: 200, editor: 200, viewer: 200, outsider: 404 },
  );
  await expectStatuses(
    "GET attachment preview",
    (client) => client.get(`/api/projects/${projectId}/attachments/${attachmentId}/preview`),
    // A text file has no Word preview; outsiders must not learn even that.
    { owner: 415, editor: 415, viewer: 415, outsider: 404 },
  );
});

test("editors change project tasks, viewers only read them", async () => {
  await expectStatuses(
    "POST project task",
    (client) => client.post("/api/tasks", { data: { title: "New project task", projectId } }),
    { owner: 201, editor: 201, viewer: 403, outsider: 400 },
  );
  // PATCH replaces the whole task, so it sends every field. Naming a project
  // the caller can't access is "Invalid project", without saying whether it exists.
  const taskUpdate = { title: "Owner project task", status: "TODO", priority: "MEDIUM", recurrence: "NONE", projectId };
  await expectStatuses(
    "PATCH project task",
    (client) => client.patch(`/api/tasks/${projectTaskId}`, { data: taskUpdate }),
    { owner: 200, editor: 200, viewer: 403, outsider: 400 },
  );
  await expectStatuses(
    "PATCH project task without naming the project",
    (client) => client.patch(`/api/tasks/${projectTaskId}`, { data: { ...taskUpdate, projectId: undefined } }),
    { viewer: 403, outsider: 404 },
  );
  await expectStatuses("DELETE project task", (client) => client.delete(`/api/tasks/${projectTaskId}`), {
    viewer: 403,
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
    { owner: 201, editor: 201, viewer: 403, outsider: 400 },
  );
  await expectStatuses(
    "POST dependency",
    (client) => client.post(`/api/tasks/${other.id}/dependencies`, { data: { blockedById: projectTaskId } }),
    { owner: 201, editor: 201, viewer: 403, outsider: 404 },
  );
  await expectStatuses(
    "DELETE dependency",
    (client) => client.delete(`/api/tasks/${other.id}/dependencies/${projectTaskId}`),
    { viewer: 403, outsider: 404, editor: 200 },
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
    { owner: 200, editor: 404, viewer: 404, outsider: 404 },
  );
  await expectStatuses(
    "link a project task to your own goal",
    async (client) => {
      const own = await json<{ id: string }>(await client.post("/api/goals", { data: { title: "My goal", targetWeek: "2026-W43" } }));
      return client.post(`/api/goals/${own.id}/tasks`, { data: { taskId: projectTaskId } });
    },
    { owner: 200, editor: 200, viewer: 403, outsider: 404 },
  );
});

test("note links follow note access; attaching an event needs edit rights", async () => {
  const projectNote = await json<{ id: string }>(
    await api.owner.post("/api/notes", { data: { title: "Project note", content: "See [[Other]]", projectId } }),
  );
  await expectStatuses("GET project note links", (client) => client.get(`/api/notes/${projectNote.id}/links`), {
    owner: 200,
    editor: 200,
    viewer: 200,
    outsider: 404,
  });
  await expectStatuses("GET personal note links", (client) => client.get(`/api/notes/${ownerPersonalNoteId}/links`), {
    owner: 200,
    editor: 404,
    viewer: 404,
    outsider: 404,
  });
  await expectStatuses("PUT note event", (client) => client.put(`/api/notes/${projectNote.id}/event`, { data: { eventId: null } }), {
    owner: 200,
    editor: 200,
    viewer: 403,
    outsider: 404,
  });
  await expectStatuses(
    "POST task from someone else's personal note",
    (client) => client.post("/api/tasks", { data: { title: "From a note", noteId: ownerPersonalNoteId } }),
    { editor: 400, viewer: 400, outsider: 400 },
  );
});

test("personal notes stay private, even to teammates", async () => {
  await expectStatuses(
    "PATCH personal note",
    (client) =>
      client.patch(`/api/notes/${ownerPersonalNoteId}`, {
        data: { title: "Owner personal note", content: "Changed" },
      }),
    { owner: 200, editor: 404, viewer: 404, outsider: 404 },
  );
  await expectStatuses("DELETE personal note", (client) => client.delete(`/api/notes/${ownerPersonalNoteId}`), {
    editor: 404,
    viewer: 404,
    outsider: 404,
  });
});

test("only the owner changes automations; every member sees them", async () => {
  const rule = { trigger: "TASK_COMPLETED", action: "EMAIL_OWNER" };
  const rules = `/api/projects/${projectId}/automations`;
  await expectStatuses("POST automation", (client) => client.post(rules, { data: rule }), {
    editor: 403,
    viewer: 403,
    outsider: 404,
  });
  const created = await json<{ id: string }>(await api.owner.post(rules, { data: rule }));
  await expectStatuses("POST the same automation again", (client) => client.post(rules, { data: rule }), { owner: 409 });
  await expectStatuses("GET automations", (client) => client.get(rules), { owner: 200, editor: 200, viewer: 200, outsider: 404 });
  await expectStatuses(
    "PATCH automation",
    (client) => client.patch(`${rules}/${created.id}`, { data: { enabled: false } }),
    { editor: 403, viewer: 403, outsider: 404, owner: 200 },
  );

  // An "assign to" rule only takes this project's members.
  const otherProject = await json<{ id: string }>(await api.outsider.post("/api/projects", { data: { name: uniqueName("Other") } }));
  const stranger = await json<{ id: string }>(
    await api.outsider.post(`/api/projects/${otherProject.id}/members`, { data: { name: "Stranger", role: "EDITOR" } }),
  );
  const assign = (memberId: string) => ({ trigger: "TASK_CREATED", action: "ASSIGN_MEMBER", memberId });
  await expectStatuses("POST assign rule for another project's member", (client) => client.post(rules, { data: assign(stranger.id) }), {
    owner: 400,
  });
  await expectStatuses("POST assign rule", (client) => client.post(rules, { data: assign(editorMemberId) }), { owner: 201 });

  await expectStatuses("DELETE automation", (client) => client.delete(`${rules}/${created.id}`), {
    editor: 403,
    viewer: 403,
    outsider: 404,
    owner: 200,
  });
  await expectStatuses("DELETE it again", (client) => client.delete(`${rules}/${created.id}`), { owner: 404 });
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

  // The owner and the editor see it in their trash, with who deleted it; others don't.
  expect(await trashedTask("owner")).toMatchObject({ deletedByName: names.editor, projectName, ownedByYou: true });
  expect(await trashedTask("editor")).toMatchObject({ deletedByName: null, projectName, ownedByYou: false });
  expect(await trashedTask("viewer")).toBeUndefined();
  expect(await trashedTask("outsider")).toBeUndefined();

  await expectStatuses("restore a teammate's task", restore, { viewer: 404, outsider: 404 });
  expect((await api.editor.patch("/api/trash", { data: { type: "project", id: taskId } })).status()).toBe(400);

  // Emptying the editor's trash leaves the owner's task alone.
  await json(await api.editor.delete("/api/trash"));
  expect(await trashedTask("editor")).toBeTruthy();

  await expectStatuses("restore a teammate's task", restore, { editor: 200 });
  expect(await trashedTask("owner")).toBeUndefined();
  const tasks = await json<{ id: string }[]>(await api.owner.get("/api/tasks"));
  expect(tasks.some((task) => task.id === taskId)).toBe(true);
});

test("only the owner shares the project or links GitHub; the token never reaches members", async () => {
  const share = `/api/projects/${projectId}/share`;
  const github = `/api/projects/${projectId}/github`;
  await expectStatuses("POST share link", (client) => client.post(share), { editor: 403, viewer: 403, outsider: 404 });
  const { path } = await json<{ path: string }>(await api.owner.post(share));
  expect(path).toMatch(/^\/share\/[A-Za-z0-9_-]{32}$/);
  const token = path.split("/").pop()!;
  for (const role of ["owner", "editor", "viewer"] as const) {
    const detail = await (await api[role].get(`/api/projects/${projectId}`)).text();
    const list = await (await api[role].get("/api/projects")).text();
    expect.soft(detail.includes(token), `project detail as ${role}`).toBe(false);
    expect.soft(list.includes(token), `project list as ${role}`).toBe(false);
  }
  await expectStatuses("DELETE share link", (client) => client.delete(share), { editor: 403, viewer: 403, outsider: 404, owner: 200 });

  await expectStatuses("PUT GitHub repository", (client) => client.put(github, { data: { repo: "ai-multi-demo/roadmap" } }), {
    editor: 403,
    viewer: 403,
    outsider: 404,
    owner: 200,
  });
  await expectStatuses("GET GitHub panel", (client) => client.get(github), { owner: 200, editor: 200, viewer: 200, outsider: 404 });
  await expectStatuses("DELETE GitHub repository", (client) => client.delete(github), { editor: 403, viewer: 403, outsider: 404, owner: 200 });
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
    ["POST member", () => anonymous.post(`/api/projects/${projectId}/members`, { data: { name: "x", role: "VIEWER" } })],
    ["GET automations", () => anonymous.get(`/api/projects/${projectId}/automations`)],
    ["POST share link", () => anonymous.post(`/api/projects/${projectId}/share`)],
    ["PUT GitHub repository", () => anonymous.put(`/api/projects/${projectId}/github`, { data: { repo: "a/b" } })],
    ["POST automation", () => anonymous.post(`/api/projects/${projectId}/automations`, { data: { trigger: "TASK_CREATED", action: "EMAIL_OWNER" } })],
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
