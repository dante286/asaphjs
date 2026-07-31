"use client";

import { signOutAction } from "@/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button className="btn btn-secondary" type="submit">
        Sign out
      </button>
    </form>
  );
}
