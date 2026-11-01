import { expect, test, type Locator, type Page } from "@playwright/test";
import { continueAsGuest, uniqueName } from "./helpers";

// The message box grows with its text, like WhatsApp's: up to 6 lines on a phone and 10 on wider
// screens, never past 40% of the window's height, then it scrolls inside (#304).

/** The box's height, its text's line height and padding, and whether its text overflows into a scrollbar. */
function measure(box: Locator) {
  return box.evaluate((element: HTMLTextAreaElement) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      scrolls: element.scrollHeight > element.clientHeight + 1,
    };
  });
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join("\n");
}

async function openNewProjectChat(page: Page, messages = 0) {
  await continueAsGuest(page);
  const project = (await (await page.request.post("/api/projects", { data: { name: uniqueName("E2E composer") } })).json()) as {
    id: string;
  };
  for (let index = 1; index <= messages; index += 1) {
    expect((await page.request.post(`/api/projects/${project.id}/comments`, { data: { message: `Update ${index}` } })).status()).toBe(201);
  }
  await page.goto(`/projects/${project.id}/chat`);
  return page.getByPlaceholder(/share an update/i);
}

test("the message box grows with its text up to a limit, then scrolls", async ({ page }) => {
  // The open chat checks for teammates' messages every few seconds, and a check that brings messages
  // also scrolls to the latest one. Answer "no change", so only the growing box can move the thread.
  await page.route("**/api/projects/*/comments*", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { version: "e2e", changed: false } }) : route.fallback(),
  );
  // Enough messages for the thread to scroll.
  const box = await openNewProjectChat(page, 12);
  const latest = page.getByText("Update 12", { exact: true });
  await expect(latest).toBeInViewport({ ratio: 1 });
  const viewport = page.viewportSize()!;
  const empty = await measure(box);

  // A few lines: the box fits them exactly, without a scrollbar.
  await box.click();
  await box.fill(lines(3));
  await expect.poll(async () => (await measure(box)).height).toBeCloseTo(3 * empty.lineHeight + empty.padding, 0);
  expect((await measure(box)).scrolls).toBe(false);

  // Many lines: it stops at the limit and scrolls inside, and the latest message stays in view.
  await box.fill(lines(30));
  const limit = Math.min((viewport.width < 640 ? 6 : 10) * empty.lineHeight + empty.padding, 0.4 * viewport.height);
  await expect.poll(async () => (await measure(box)).height).toBeCloseTo(limit, 0);
  expect((await measure(box)).scrolls).toBe(true);
  await expect(latest).toBeInViewport({ ratio: 1 });

  // On wider screens the buttons stay at the bottom of the box, next to the last line.
  if (viewport.width >= 640) {
    const boxBounds = (await box.boundingBox())!;
    for (const name of ["Attach files", "Send message"]) {
      const bounds = (await page.getByRole("button", { name }).boundingBox())!;
      expect(Math.abs(bounds.y + bounds.height - (boxBounds.y + boxBounds.height)), `${name} sits at the bottom`).toBeLessThanOrEqual(2);
    }
  }

  // Sending empties the box, and it shrinks back to one line.
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(box).toHaveValue("");
  await expect.poll(async () => (await measure(box)).height).toBeCloseTo(empty.height, 0);
});

test("the message box follows its text when the window gets narrower", async ({ page, isMobile }) => {
  test.skip(isMobile, "A phone's window doesn't change width.");
  const box = await openNewProjectChat(page);
  await box.fill("All the launch notes go in this one long paragraph. ".repeat(6));
  const wide = await measure(box);
  expect(wide.scrolls).toBe(false);

  // Narrower lines wrap more, so the box gets taller, still without a scrollbar.
  await page.setViewportSize({ width: 1024, height: page.viewportSize()!.height });
  await expect.poll(async () => (await measure(box)).height).toBeGreaterThan(wide.height);
  expect((await measure(box)).scrolls).toBe(false);
});
