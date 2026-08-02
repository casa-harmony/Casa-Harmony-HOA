"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./providers";
import { Spinner } from "@/components/ui";

export default function Home() {
  const { ready, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(token ? "/dashboard" : "/login");
  }, [ready, token, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}
