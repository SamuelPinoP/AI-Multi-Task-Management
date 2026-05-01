import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";
const DEFAULT_MODEL = "gpt-4.1-mini";

type AiTaskSuggestion = {
  title: string;
  description?: string;
};

type AiTaskResponse = {
  tasks: AiTaskSuggestion[];
  message?: string;
};

function normalizeAiTasks(value: unknown): AiTaskResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as { tasks?: unknown; message?: unknown };
  if (!Array.isArray(parsed.tasks)) {
    return null;
  }

  const tasks = parsed.tasks
    .slice(0, 5)
    .map((task) => {
      if (!task || typeof task !== "object") return null;
      const input = task as { title?: unknown; description?: unknown };
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const description = typeof input.description === "string" ? input.description.trim() : "";

      if (!title) return null;

      return {
        title,
        description: description || undefined,
      };
    })
    .filter((task): task is AiTaskSuggestion => task !== null);

  return {
    tasks,
    message: typeof parsed.message === "string" ? parsed.message.trim() : undefined,
  };
}

async function generateTasksFromNote(noteTitle: string, noteContent: string): Promise<AiTaskResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You convert notes into practical, actionable productivity tasks. Return only JSON.",
        },
        {
          role: "user",
          content: `Turn this note into 2 to 5 actionable tasks.\n\nNote title: ${noteTitle}\nNote content: ${noteContent || "(empty)"}\n\nRules:\n- Return JSON only with shape: {\"tasks\":[{\"title\":string,\"description\":string}],\"message\":string}.\n- Tasks must be specific action items, not summaries.\n- If the note does not contain actionable items, return tasks as an empty array and provide a short helpful message.\n- Keep each title concise.`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "note_to_tasks",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              tasks: {
                type: "array",
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["title", "description"],
                },
              },
              message: { type: "string" },
            },
            required: ["tasks", "message"],
          },
        },
      },
      max_output_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI request failed: ${errorText}`);
  }

  const payload = (await response.json()) as { output_text?: unknown };
  const outputText = typeof payload.output_text === "string" ? payload.output_text : "";

  if (!outputText) {
    throw new Error("AI returned an empty response");
  }

  const parsed = JSON.parse(outputText) as unknown;
  const normalized = normalizeAiTasks(parsed);
  if (!normalized) {
    throw new Error("AI response format was invalid");
  }

  return normalized;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const noteId = typeof body.noteId === "string" ? body.noteId : "";

    if (!noteId) {
      return NextResponse.json({ error: "noteId is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const note = await prisma.note.findFirst({
      where: {
        id: noteId,
        userId: user.id,
      },
    });

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const noteTitle = note.title.trim();
    const noteContent = (note.content ?? "").trim();

    if (!noteTitle && !noteContent) {
      return NextResponse.json(
        { error: "The note is empty. Add some details first, then try again." },
        { status: 400 }
      );
    }

    const aiResult = await generateTasksFromNote(noteTitle, noteContent);

    if (aiResult.tasks.length === 0) {
      return NextResponse.json(
        {
          createdCount: 0,
          tasks: [],
          message: aiResult.message || "No actionable tasks were found in this note.",
        },
        { status: 200 }
      );
    }

    const createdTasks = await prisma.task.createManyAndReturn({
      data: aiResult.tasks.map((task) => ({
        title: task.title,
        description: task.description ?? null,
        userId: user.id,
      })),
    });

    return NextResponse.json({
      createdCount: createdTasks.length,
      tasks: createdTasks,
      message: `Created ${createdTasks.length} task${createdTasks.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    console.error("POST /api/ai/note-to-tasks error:", error);

    if (error instanceof Error && error.message.includes("OPENAI_API_KEY")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Failed to turn note into tasks" }, { status: 500 });
  }
}
