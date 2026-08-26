# AI-Multi Task-Management

Live Demo: https://ai-multi-task-management-vercel.vercel.app

## Demo Video
Watch the demo:
https://studio.youtube.com/channel/UCsAQln_0zQCjK95fsJ_kUUA/videos/upload?filter=%5B%5D&sort=%7B%22columnType%22%3A%22date%22%2C%22sortOrder%22%3A%22DESCENDING%22%7D

AI-Multi Task-Management is a full-stack productivity and collaboration platform built with Next.js, TypeScript, Prisma, PostgreSQL, and Vercel. It supports authentication, notes, tasks, events, projects, Kanban project boards, project chat, file uploads, invitations, password reset, search, trash, planning views, recurrence, guest mode, and dark mode.

## Key Features

- Secure authentication with signup, login, logout, sessions, and password reset
- Notes, tasks, events, projects, calendars, a rule-based Smart Daily Planner, and trash recovery
- Project-specific Kanban boards for organizing tasks by status with read-only Viewer access and Owner/Editor task creation and movement
- Project collaboration with invitations and role-based Owner, Editor, and Viewer access enforced server-side
- Project chat with file attachments using local, Vercel Blob, or private AWS S3 storage

## Project chat attachment storage

Route uploads with `PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER` and
`PROJECT_CHAT_VIDEO_STORAGE_PROVIDER`. For production, ordinary files can use
`vercel-blob` while validated video extensions use private `aws-s3`; local/local
is the normal development configuration. Each attachment records its provider
and key, so later configuration changes do not change where it is read or deleted.

The deprecated `PROJECT_CHAT_STORAGE_PROVIDER` remains a fallback. An explicit
default or video variable wins for its category; otherwise the legacy value is
used, then the video provider falls back to the resolved default, then local is
the final development default.

- `local` writes to `public/uploads/project-chat` and is intended only for local development.
- `vercel-blob` uses `BLOB_READ_WRITE_TOKEN` and optional `PROJECT_CHAT_BLOB_PREFIX`.
- `aws-s3` uses a private S3 bucket. AWS configuration is required only when one routing target selects S3; static access keys remain optional because the SDK default credential provider chain supports IAM roles.

When videos route to S3, the browser uploads them directly with a short-lived presigned PUT URL so large video bodies do not pass through a Vercel Function. S3 downloads are authorized by the existing application route before it creates a short-lived presigned GET URL (10 minutes by default). An expiring URL limits the time a copied link can access the private object; it is not a permanent public URL. See [the AWS S3 storage guide](docs/aws-s3-storage.md) for setup, security, Vercel deployment, cleanup, CORS, and cost controls.

Run storage tests with `npm run test:storage`. No test contacts AWS or needs real credentials.
- PostgreSQL database modeled with Prisma migrations
- Production deployment on Vercel with Neon PostgreSQL and server-side environment validation
- Smart Daily Planner that analyzes overdue tasks, due-today work, upcoming events, active projects, recent notes, and project follow-up signals without relying on a paid external AI service
- Dark mode and responsive UI

## Tech Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS
- Backend: Next.js Route Handlers / Server Actions
- Database: PostgreSQL, Prisma ORM, pgAdmin 4
- Storage: local filesystem, Vercel Blob, or private AWS S3 with hybrid routing
- Deployment: Vercel
- Email: Resend optional, in-app invitations supported without email

## Screenshots

### Dashboard
![Dashboard screenshot](docs/screenshots/dashboard.png)

### Projects
![Projects screenshot](docs/screenshots/projects.png)

### Project Chat
![Project chat screenshot](docs/screenshots/project-chat.png)


### Main Task Board

The app includes a dedicated `/board` productivity area linked from the main navigation as **Task Board**. It currently supports:

- **Kanban View** for organizing personal and project tasks by status across the workspace.
- **Tree View** for user-specific editable hierarchy pages, such as Warrior, Study Plan, or Career Plan, with root nodes, child nodes, sibling nodes, renaming, deletion, simple reordering, and parent changes.
- A disabled **Mindnote View** entry point so the board structure can be extended later without changing the primary navigation.
