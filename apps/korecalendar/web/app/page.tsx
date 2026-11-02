import { redirect } from "next/navigation";

// Replaced by the preference-aware redirect once the shell exists.
export default function Home() {
  redirect("/calendar/week");
}
