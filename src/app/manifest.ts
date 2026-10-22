import type { MetadataRoute } from "next";

/** Web app manifest (SMART-10), served at /manifest.webmanifest. Icons: scripts/generate-app-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AI Multi",
    short_name: "AI Multi",
    description: "Tasks, notes, events and projects in one place. Pages you've opened stay readable offline.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8f7",
    theme_color: "#0a6f68",
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My day", url: "/today" },
      { name: "Tasks", url: "/tasks" },
      { name: "Calendar", url: "/events" },
      { name: "Projects", url: "/projects" },
    ],
  };
}
