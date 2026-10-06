import { describe, expect, it, vi } from "vitest";
import { ResendMailer } from "@/lib/notifications/mailer";

describe("ResendMailer", () => {
  it("poste sur l'API Resend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new ResendMailer("key", "Exquis <a@b.c>").send({ to: "x@y.z", subject: "S", text: "T" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });
  it("lève une erreur si l'API répond mal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    await expect(new ResendMailer("k", "f").send({ to: "a", subject: "b", text: "c" })).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
