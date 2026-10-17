import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "pg-boss", "web-push", "nodemailer"],
};
export default nextConfig;
