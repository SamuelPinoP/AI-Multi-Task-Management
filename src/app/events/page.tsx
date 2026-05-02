"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type EventItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
};

function toInputDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 16);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");

  const visibleEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [events]);

  async function fetchEvents(showLoading = true) {
    try {
      if (showLoading) setFetching(true);
      setError("");

      const res = await fetch("/api/events");
      if (!res.ok) {
        throw new Error("Failed to fetch events");
      }

      const data = (await res.json()) as EventItem[];
      setEvents(data);
    } catch {
      setError("Could not load events.");
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    async function loadInitialEvents() {
      await fetchEvents();
    }

    void loadInitialEvents();
  }, []);

  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (!startTime || !endTime) {
      setError("Start time and end time are required.");
      return;
    }

    if (new Date(endTime) <= new Date(startTime)) {
      setError("End time must be after start time.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          location,
          startTime,
          endTime,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create event");
      }

      setTitle("");
      setDescription("");
      setLocation("");
      setStartTime("");
      setEndTime("");
      await fetchEvents(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event.");
    } finally {
      setLoading(false);
    }
  }

  function startEditing(event: EventItem) {
    setEditingEventId(event.id);
    setEditTitle(event.title);
    setEditDescription(event.description ?? "");
    setEditLocation(event.location ?? "");
    setEditStartTime(toInputDateTime(event.startTime));
    setEditEndTime(toInputDateTime(event.endTime));
    setError("");
  }

  function cancelEditing() {
    setEditingEventId(null);
    setEditTitle("");
    setEditDescription("");
    setEditLocation("");
    setEditStartTime("");
    setEditEndTime("");
  }

  async function handleSaveEdit(eventId: string) {
    if (!editTitle.trim()) {
      setError("Title is required.");
      return;
    }

    if (!editStartTime || !editEndTime) {
      setError("Start time and end time are required.");
      return;
    }

    if (new Date(editEndTime) <= new Date(editStartTime)) {
      setError("End time must be after start time.");
      return;
    }

    try {
      setSavingEdit(true);
      setError("");

      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          location: editLocation,
          startTime: editStartTime,
          endTime: editEndTime,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update event");
      }

      const updated = (await res.json()) as EventItem;
      setEvents((prev) => prev.map((event) => (event.id === eventId ? updated : event)));
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update event.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteEvent(eventId: string) {
    if (!window.confirm("Are you sure you want to delete this event?")) {
      return;
    }

    try {
      setDeletingEventId(eventId);
      setError("");

      const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete event");
      }

      setEvents((prev) => prev.filter((event) => event.id !== eventId));
      if (editingEventId === eventId) {
        cancelEditing();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event.");
    } finally {
      setDeletingEventId(null);
    }
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-4xl font-bold">Events</h1>
        <p className="mb-8 text-gray-600">
          Create and manage scheduled events for AI-Multi Task-Management.
        </p>

        <section className="mb-10 rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold">Create Event</h2>

          <form onSubmit={handleCreateEvent} className="space-y-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={4}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
            />
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (optional)"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
              />
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-black px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Event"}
            </button>
          </form>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Your Events</h2>
          {fetching ? (
            <p className="text-gray-600">Loading events...</p>
          ) : visibleEvents.length === 0 ? (
            <p className="text-gray-600">No events yet.</p>
          ) : (
            <div className="space-y-4">
              {visibleEvents.map((event) => {
                const isEditing = editingEventId === event.id;
                const isDeleting = deletingEventId === event.id;

                return (
                  <article
                    key={event.id}
                    className="rounded-2xl border border-gray-200 p-5 shadow-sm"
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-black"
                        />
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-black"
                        />
                        <input
                          value={editLocation}
                          onChange={(e) => setEditLocation(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-black"
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            type="datetime-local"
                            value={editStartTime}
                            onChange={(e) => setEditStartTime(e.target.value)}
                            className="rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-black"
                          />
                          <input
                            type="datetime-local"
                            value={editEndTime}
                            onChange={(e) => setEditEndTime(e.target.value)}
                            className="rounded-xl border border-gray-300 px-3 py-2 outline-none focus:border-black"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => void handleSaveEdit(event.id)}
                            disabled={savingEdit}
                            className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
                          >
                            {savingEdit ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="rounded-xl border border-gray-300 px-4 py-2"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-xl font-semibold">{event.title}</h3>
                        {event.description ? (
                          <p className="mt-2 text-gray-700">{event.description}</p>
                        ) : (
                          <p className="mt-2 text-gray-500">No description.</p>
                        )}
                        {event.location ? (
                          <p className="mt-2 text-sm text-gray-600">Location: {event.location}</p>
                        ) : (
                          <p className="mt-2 text-sm text-gray-500">No location set.</p>
                        )}
                        <p className="mt-2 text-sm text-gray-700">
                          Start: {formatDateTime(event.startTime)}
                        </p>
                        <p className="mt-1 text-sm text-gray-700">
                          End: {formatDateTime(event.endTime)}
                        </p>
                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={() => startEditing(event)}
                            className="rounded-xl border border-gray-300 px-4 py-2"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void handleDeleteEvent(event.id)}
                            disabled={isDeleting}
                            className="rounded-xl bg-red-600 px-4 py-2 text-white disabled:opacity-50"
                          >
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
