"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatRecurrenceLabel, normalizeRecurrence } from "@/lib/recurrence";
import { expandEventsForRange, type CalendarEvent } from "@/lib/event-occurrence";

type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
type EventItem = CalendarEvent & { recurrence?: Recurrence | null };

const formatDayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const formatTime = (value: Date) => new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(value);

export default function EventsCalendarPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDayKey(new Date()));

  useEffect(() => { void (async () => { try { const r = await fetch('/api/events'); if (!r.ok) throw new Error(); const data=(await r.json()) as EventItem[]; setEvents(data.map((e)=>({...e,recurrence:normalizeRecurrence(e.recurrence)}))); } catch { setError('Could not load events for the calendar.'); } finally { setFetching(false);} })(); }, []);

  const monthDays = useMemo(() => { const ms = new Date(month.getFullYear(),month.getMonth(),1); const me = new Date(month.getFullYear(),month.getMonth()+1,0); const cs=new Date(ms); cs.setDate(cs.getDate()-ms.getDay()); const ce=new Date(me); ce.setDate(ce.getDate()+(6-me.getDay())); const days:Date[]=[]; for(let c=new Date(cs); c<=ce; c.setDate(c.getDate()+1)) days.push(new Date(c)); return days; }, [month]);
  const occurrences = useMemo(() => expandEventsForRange(events, monthDays[0], monthDays[monthDays.length-1]), [events, monthDays]);
  const visibleOccurrences = useMemo(() => {
    const now = new Date();
    return occurrences.filter((o) => o.recurrence !== "NONE" || o.end >= now);
  }, [occurrences]);
  const byDay = useMemo(() => visibleOccurrences.reduce<Record<string, typeof visibleOccurrences>>((a,o)=>{const k=formatDayKey(o.start); (a[k]??=[]).push(o); return a;},{}), [visibleOccurrences]);
  const selectedDayEvents = [...(byDay[selectedDayKey] ?? [])].sort((a,b)=>a.start.getTime()-b.start.getTime());
  const selectedDayLabel = useMemo(() => { const [y,m,d]=selectedDayKey.split('-').map(Number); return new Intl.DateTimeFormat('en-US',{dateStyle:'full'}).format(new Date(y,m-1,d)); }, [selectedDayKey]);

  return <main className="min-h-screen px-6 py-10"><div className="mx-auto max-w-7xl"><div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-4xl font-bold">Full Calendar</h1></div><Link href="/events" className="rounded-xl border border-zinc-300 px-4 py-2 text-sm">Back to Events</Link></div>{error && <p className="mb-6 text-sm text-red-600">{error}</p>}<section className="rounded-2xl border p-6"><div className="mb-5 flex justify-between"><h2 className="text-2xl font-semibold">{new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric"}).format(month)}</h2><div className="flex gap-2"><button onClick={()=>setMonth((p)=>new Date(p.getFullYear(),p.getMonth()-1,1))}>Previous</button><button onClick={()=>setMonth((p)=>new Date(p.getFullYear(),p.getMonth()+1,1))}>Next</button></div></div><div className="grid grid-cols-7 gap-2">{monthDays.map((day)=>{const dayKey=formatDayKey(day); const eventCount=byDay[dayKey]?.length??0; return <button key={dayKey} onClick={()=>setSelectedDayKey(dayKey)} className="min-h-20 rounded border p-2 text-left"><span>{day.getDate()}</span>{eventCount>0 && <span> {eventCount}</span>}</button>;})}</div><aside className="mt-4"><h3 className="text-lg font-semibold">{selectedDayLabel}</h3>{selectedDayEvents.map((event)=><article key={event.id}><p>{event.title}</p><p>{event.allDay?"Time not specified":`${formatTime(event.start)} - ${formatTime(event.end)}`}</p><p>Repeats: {formatRecurrenceLabel(event.recurrence)}</p></article>)}{!fetching && selectedDayEvents.length===0 && <p>No events planned for this day.</p>}</aside></section></div></main>;
}
