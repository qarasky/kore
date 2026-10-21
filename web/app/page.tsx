import { redirect } from "next/navigation";
import { DEFAULT_LANDING } from "@/lib/safe-next";

export default function Home() {
  redirect(DEFAULT_LANDING);
}
