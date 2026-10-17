import { LoginForm } from "@/components/LoginForm";
import { Banner } from "@/components/ui/Banner";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main>
      <Banner title="Connexion" />
      <LoginForm inviteOnly={env().REGISTRATION_MODE === "invite"} />
    </main>
  );
}
