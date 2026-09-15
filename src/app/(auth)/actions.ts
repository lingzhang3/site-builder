"use server";

import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth, signIn, signOut } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { createOrgForUser, firstOrgForUser } from "@/lib/orgs";

export interface AuthFormState {
  error?: string;
}

const signupSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(200, "That password is too long."),
  orgName: z.string().trim().min(1, "Please name your workspace.").max(120),
});

export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    orgName: formData.get("orgName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const { name, email, password, orgName } = parsed.data;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    // Sign-up has to reveal that an email is taken in order to explain the
    // failure. Sign-in deliberately does not.
    return { error: "An account with that email already exists. Try signing in." };
  }

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash: hashPassword(password) })
    .returning();

  if (!user) return { error: "Could not create the account. Please try again." };

  const org = await createOrgForUser(user.id, orgName);

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created, but sign-in failed. Try signing in." };
    }
    // A redirect is signalled by throwing; it must reach Next, not be swallowed.
    throw error;
  }

  redirect(`/${org.slug}`);
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  password: z.string().min(1, "Please enter your password."),
});

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  try {
    await signIn("credentials", { ...parsed.data, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // One message for "no such user" and for "wrong password", so the form
      // cannot be used to find out which emails are registered.
      return { error: "Incorrect email or password." };
    }
    throw error;
  }

  const session = await auth();
  const userId = session?.user?.id;
  const org = userId ? await firstOrgForUser(userId) : null;

  redirect(org ? `/${org.slug}` : "/");
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
