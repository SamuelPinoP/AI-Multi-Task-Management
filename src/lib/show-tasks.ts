"use client";

import { useSyncExternalStore } from "react";

/**
 * The Calendar's "Show tasks" switch, shared by the Agenda and Month tabs
 * (DES-17) and kept in localStorage so it stays as the user left it. Tasks
 * show by default; storage can be unavailable (private windows), in which case
 * the switch still works for the visit.
 */
const SHOW_TASKS_KEY = "ai-multi-calendar-show-tasks";
const showTasksListeners = new Set<() => void>();
let showTasksFallback = true;

function readShowTasks() {
  try {
    const saved = localStorage.getItem(SHOW_TASKS_KEY);
    return saved === null ? showTasksFallback : saved !== "false";
  } catch {
    return showTasksFallback;
  }
}

function writeShowTasks(value: boolean) {
  showTasksFallback = value;
  try {
    localStorage.setItem(SHOW_TASKS_KEY, String(value));
  } catch {
    // Not saved; the fallback keeps it for this visit.
  }
  showTasksListeners.forEach((listener) => listener());
}

/** Follows the switch here and in other tabs (the storage event). */
function subscribeShowTasks(listener: () => void) {
  showTasksListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    showTasksListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Whether due tasks show on the Calendar, and its setter. The server render always shows them. */
export function useShowTasks() {
  const showTasks = useSyncExternalStore(subscribeShowTasks, readShowTasks, () => true);
  return [showTasks, writeShowTasks] as const;
}
