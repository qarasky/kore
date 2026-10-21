import { NotFoundView } from "@/components/NotFoundView";

/** 404 for URLs that match no route. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh">
      <NotFoundView />
    </main>
  );
}
