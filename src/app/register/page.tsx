import { RegisterForm } from "@/components/RegisterForm";
import { Banner } from "@/components/ui/Banner";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <main>
      <Banner title="Créer un compte" />
      <RegisterForm inviteOnly={env().REGISTRATION_MODE === "invite"} />
    </main>
  );
}
