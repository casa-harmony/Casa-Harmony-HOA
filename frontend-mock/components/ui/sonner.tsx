"use client";

import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Wired to this app's own theme provider rather than next-themes, so toasts
 * follow the light / dark / system control in the header.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
