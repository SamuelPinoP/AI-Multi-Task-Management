// Live check for the aws-s3 project-chat storage (AWS S3 or Cloudflare R2).
//
// Runs the app's own storage code against the real bucket, the way the browser
// and API routes use it: uploads a tiny object through a presigned URL, checks
// that an upload with a different size than declared is refused, reads the
// object back, checks CORS for APP_BASE_URL, and deletes everything it created.
//
// Reads .env (or the file named by DOTENV_CONFIG_PATH). Prints only HTTP
// statuses, never keys or presigned URLs. Costs two writes and a few reads.
//
//   npm run verify:storage
import "dotenv/config";
import {
  configuredUploadProviders,
  confirmProjectChatDirectUploadedAttachment,
  createProjectChatAttachmentUploadPlan,
  deleteProjectChatAttachments,
  readProjectChatAttachment,
  type ProjectChatStoredAttachment,
} from "../src/lib/project-chat-storage";

const CHECK_TEXT = "project chat storage check\n";
const CHECK_BYTES = new TextEncoder().encode(CHECK_TEXT).byteLength;

let failures = 0;

function report(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures += 1;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function directUploadPlan(fileName: string) {
  const plan = await createProjectChatAttachmentUploadPlan({ name: fileName, type: "", size: CHECK_BYTES });
  if (plan.strategy !== "direct-s3") throw new Error(`${fileName} is not routed to aws-s3.`);
  return plan;
}

async function main() {
  const { defaultProvider, videoProvider } = configuredUploadProviders();
  const fileName = videoProvider === "aws-s3" ? "storage-check.mp4" : defaultProvider === "aws-s3" ? "storage-check.txt" : null;
  if (!fileName) {
    console.error("No upload route selects aws-s3. Set PROJECT_CHAT_VIDEO_STORAGE_PROVIDER or PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER to aws-s3.");
    process.exitCode = 1;
    return;
  }

  const created: ProjectChatStoredAttachment[] = [];
  try {
    const plan = await directUploadPlan(fileName);
    created.push(plan.storedAttachment);
    const upload = await fetch(plan.uploadUrl, { method: plan.uploadMethod, headers: plan.uploadHeaders, body: CHECK_TEXT });
    report(upload.ok, "upload with the declared size is accepted", `HTTP ${upload.status}`);

    if (upload.ok) {
      try {
        await confirmProjectChatDirectUploadedAttachment(plan.storedAttachment);
        report(true, "stored object has the declared size and type");
      } catch (error) {
        report(false, "stored object has the declared size and type", errorMessage(error));
      }

      const read = await readProjectChatAttachment(plan.storedAttachment, { fileName });
      if (read.kind !== "redirect") throw new Error("Expected a presigned download URL.");
      const download = await fetch(read.url);
      const text = download.ok ? await download.text() : "";
      report(download.ok && text === CHECK_TEXT, "download returns the uploaded bytes", `HTTP ${download.status}`);
    }

    const sizePlan = await directUploadPlan(fileName);
    created.push(sizePlan.storedAttachment);
    const oversized = await fetch(sizePlan.uploadUrl, { method: sizePlan.uploadMethod, headers: sizePlan.uploadHeaders, body: `${CHECK_TEXT}!` });
    report(!oversized.ok, "upload larger than declared is refused", `HTTP ${oversized.status}`);

    const appBaseUrl = process.env.APP_BASE_URL?.trim();
    if (appBaseUrl) {
      const origin = new URL(appBaseUrl).origin;
      const preflight = await fetch(plan.uploadUrl, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
      });
      const allowedOrigin = preflight.headers.get("access-control-allow-origin");
      report(
        preflight.ok && (allowedOrigin === origin || allowedOrigin === "*"),
        `CORS allows browser uploads from ${origin}`,
        `HTTP ${preflight.status}, Access-Control-Allow-Origin: ${allowedOrigin ?? "missing"}`,
      );
    } else {
      console.log("SKIP CORS check (set APP_BASE_URL to the app's origin to run it)");
    }
  } catch (error) {
    report(false, "storage check ran to the end", errorMessage(error));
  } finally {
    try {
      await deleteProjectChatAttachments(created);
      // A deleted object answers 404, or 403 on AWS without ListBucket permission.
      const gone = await Promise.all(created.map(async (attachment) => {
        const read = await readProjectChatAttachment(attachment);
        return read.kind === "redirect" && !(await fetch(read.url)).ok;
      }));
      report(gone.every(Boolean), `test objects deleted (${created.length})`);
    } catch (error) {
      report(false, `test objects deleted (${created.length})`, errorMessage(error));
    }
  }

  console.log(failures === 0 ? "\nStorage check passed." : `\nStorage check failed: ${failures} problem(s).`);
  // Set the code instead of calling process.exit(): exiting while connections
  // are still closing crashes Node on Windows.
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("Storage check could not run:", errorMessage(error));
  process.exitCode = 1;
});
