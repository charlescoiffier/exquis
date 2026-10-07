import { redirect } from "next/navigation";
import { NewGameForm } from "@/components/NewGameForm";
import { Banner } from "@/components/ui/Banner";
import { getSession } from "@/lib/session";

export default async function NewGamePage() {
  if (!(await getSession())) redirect("/login");
  return (
    <main>
      <Banner title="Nouvelle partie" />
      <NewGameForm />
    </main>
  );
}
