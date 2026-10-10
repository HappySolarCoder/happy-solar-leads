"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users, ArrowRight } from "lucide-react";
import { getCurrentAuthUser } from "@/app/utils/auth";
import { MobileLoading } from "../_components/MobileShell";
export default function WorkspacePage() {
  const [state, setState] = useState("loading");
  useEffect(() => {
    let active = true;
    getCurrentAuthUser()
      .then((user) => {
        if (active)
          setState(
            user?.role === "admin" ? "ready" : "Admin access is required."
          );
      })
      .catch(() => {
        if (active)
          setState(
            "Could not verify access. Return to your account and try again."
          );
      });
    return () => {
      active = false;
    };
  }, []);
  if (state === "loading") return <MobileLoading />;
  return (
    <div className="rm-shell">
      <main className="rm-content">
        <Link className="rm-back" href="/mobile/more">
          <ArrowLeft size={18} />
          Account
        </Link>
        <div className="rm-page-heading">
          <h1>Manage workspace</h1>
          <p>Administration for your Raydar team.</p>
        </div>
        {state !== "ready" ? (
          <p role="alert">{state}</p>
        ) : (
          <Link href="/mobile/workspace/users" className="rm-menu-row">
            <Users size={24} />
            <span>
              <strong>Manage Users</strong>
              <small>Manage accounts and remove former team members</small>
            </span>
            <ArrowRight size={20} />
          </Link>
        )}
      </main>
    </div>
  );
}
