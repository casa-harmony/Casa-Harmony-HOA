"use client";

/**
 * Mount point for review mode — one line in the root layout.
 *
 * Renders nothing at all until someone arrives with `?review=<passcode>`, so
 * an ordinary visitor gets the ordinary site.
 */

import React from "react";
import { PinLayer } from "./overlay";
import { ReviewProvider, useReview } from "./provider";
import { Toolbar } from "./toolbar";

function Surface() {
  const { phase } = useReview();
  if (phase !== "ready" && phase !== "passcode") return null;
  return (
    <>
      {phase === "ready" && <PinLayer />}
      <Toolbar />
    </>
  );
}

export function ReviewLayer() {
  return (
    <ReviewProvider>
      <Surface />
    </ReviewProvider>
  );
}
