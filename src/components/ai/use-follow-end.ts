"use client";

import { useCallback, useEffect, useRef, type RefObject, type UIEvent } from "react";

/** How close to the end, in pixels, still counts as reading the end of the conversation. */
const NEAR_END_PX = 80;

/**
 * Keeps an AI conversation scrolled to its newest words while the reader is at the end: streamed
 * text, the card of changes an answer proposes (#310), a line that wraps once a font loads. It's
 * shared by the AI page and the AI bar's chat.
 *
 * Only the reader scrolling up stops the following; content that grows never does. Before (#536),
 * every scroll event re-measured "at the end", and a tall card that landed between the browser's
 * scroll event and React's effect read as the reader having left the end: on phones the
 * "Choose what to apply" card then stayed below the screen about a third of the time. Now a
 * ResizeObserver on the conversation's contents scrolls to the end whenever they change size
 * while the reader is there, whatever changed them.
 *
 * A question sent goes in at the end, so it takes the reader there, wherever they were reading.
 * Only the suggestions did that before; a question sent from the message box after scrolling up
 * went in below the screen, and its answer arrived there unseen (#568).
 *
 * `scrollerRef` and `atEndRef` are the caller's refs: callers set `atEndRef.current = true` when
 * they start or open a chat, and read `scrollerRef.current` as before. `busy` is the chat's: it
 * turns true when a question is sent (from the message box, a suggestion or Try again) and while a
 * stored chat opens, and either way the reader goes to the end. Put the returned `attach` (a
 * callback ref) and `onScroll` on the scrolling element; `attach` (re)connects whenever that
 * element mounts.
 */
export function useFollowEnd(scrollerRef: RefObject<HTMLDivElement | null>, atEndRef: RefObject<boolean>, busy: boolean) {
  // Where the last scroll event left the conversation, to tell scrolling up from content growing.
  const lastTop = useRef(0);

  // Going to the end only as busy turns true: scrolling up while the answer arrives still stops the following.
  useEffect(() => {
    if (!busy) return;
    atEndRef.current = true;
    const element = scrollerRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [busy, scrollerRef, atEndRef]);

  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      scrollerRef.current = element;
      if (!element) return;
      const follow = () => {
        if (atEndRef.current) element.scrollTop = element.scrollHeight;
        lastTop.current = element.scrollTop;
      };
      // The scroller keeps its own size; its children grow. They change as the chat does (empty,
      // loading, the thread, the notice), so the observed set follows them. Their border boxes, so
      // padding and borders that grow count too, not only what's inside.
      const sizes = new ResizeObserver(follow);
      const watchChildren = () => {
        sizes.disconnect();
        for (const child of element.children) sizes.observe(child, { box: "border-box" });
      };
      watchChildren();
      const children = new MutationObserver(watchChildren);
      children.observe(element, { childList: true });
      return () => {
        sizes.disconnect();
        children.disconnect();
        scrollerRef.current = null;
      };
    },
    [scrollerRef, atEndRef],
  );

  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const top = element.scrollTop;
      if (element.scrollHeight - top - element.clientHeight < NEAR_END_PX) atEndRef.current = true;
      // Moving up means the reader went back to read; growth below never moves the top up.
      else if (top < lastTop.current) atEndRef.current = false;
      lastTop.current = top;
    },
    [atEndRef],
  );

  return { attach, onScroll };
}
