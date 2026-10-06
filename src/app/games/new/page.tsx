import { redirect } from "next/navigation";
import { NewGameForm } from "@/components/NewGameForm";
import { getSession } from "@/lib/session";

export default async function NewGamePage() {
  if (!(await getSession())) redirect("/login");
  return (
    <main>
      <h1>Nouvelle partie</h1>
      <NewGameForm />
    </main>
  );
}
