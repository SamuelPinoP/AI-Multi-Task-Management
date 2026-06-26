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
- Project chat with file attachments using Vercel Blob storage
- PostgreSQL database modeled with Prisma migrations
- Production deployment on Vercel with Neon PostgreSQL and server-side environment validation
- Smart Daily Planner that analyzes overdue tasks, due-today work, upcoming events, active projects, recent notes, and project follow-up signals without relying on a paid external AI service
- Dark mode and responsive UI

## Tech Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS
- Backend: Next.js Route Handlers / Server Actions
- Database: PostgreSQL, Prisma ORM, pgAdmin 4
- Storage: Vercel Blob
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
