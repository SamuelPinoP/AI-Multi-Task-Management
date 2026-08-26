import mammoth from "mammoth";
import {
  projectChatAttachmentContentDisposition,
  readProjectChatAttachment,
  type ProjectChatStoredAttachmentReference,
} from "@/lib/project-chat-storage";

export function isPreviewableDocxAttachment(fileName: string, fileType: string) {
  return (
    fileName.toLowerCase().endsWith(".docx") ||
    fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function attachmentBytes(
  attachment: ProjectChatStoredAttachmentReference,
  fileName: string,
) {
  const storedFile = await readProjectChatAttachment(attachment, {
    disposition: "inline",
    fileName,
  });

  if (storedFile.kind === "redirect") {
    const response = await fetch(storedFile.url, { cache: "no-store" });
    if (!response.ok) throw new Error("AttachmentFetchError");
    return Buffer.from(await response.arrayBuffer());
  }

  return Buffer.from(await new Response(storedFile.body).arrayBuffer());
}

function previewHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      background: #f4f4f5;
      color: #18181b;
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.6;
    }
    main {
      box-sizing: border-box;
      width: min(920px, calc(100vw - 32px));
      min-height: calc(100vh - 32px);
      margin: 16px auto;
      padding: 48px;
      background: #ffffff;
      box-shadow: 0 12px 36px rgba(24, 24, 27, 0.12);
    }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { border: 1px solid #d4d4d8; padding: 6px 8px; vertical-align: top; }
    h1, h2, h3 { line-height: 1.25; }
    @media (max-width: 640px) {
      main {
        width: 100%;
        min-height: 100vh;
        margin: 0;
        padding: 24px;
      }
    }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

export async function projectChatDocxPreviewResponse(
  attachment: ProjectChatStoredAttachmentReference,
  fileName: string,
) {
  const result = await mammoth.convertToHtml(
    { buffer: await attachmentBytes(attachment, fileName) },
    {
      convertImage: mammoth.images.dataUri,
      externalFileAccess: false,
    },
  );

  return new Response(previewHtml(fileName, result.value), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": projectChatAttachmentContentDisposition(`${fileName}.html`, "inline"),
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
