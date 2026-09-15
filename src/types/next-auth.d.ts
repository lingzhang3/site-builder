import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Always present for a signed-in user; set in the session callback. */
      id: string;
    } & DefaultSession["user"];
  }
}
