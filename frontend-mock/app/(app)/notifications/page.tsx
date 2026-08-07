"use client";

import { useMemo, useState } from "react";
import { Bell, BellOff, CheckCheck, Inbox, Users } from "lucide-react";
import { useApi, useMutate } from "@/lib/use-api";
import { Badge, Button, Card } from "@/components/ui";
import {
  EmptyState, FilterChips, PageHeader, PageShell, SectionGuide, StatCard,
  StatGrid, Toolbar, relTime, shortDate,
} from "@/components/app/kit";
import { cn } from "@/lib/utils";

const CATEGORY_TONE: Record<string, string> = {
  INFO: "info",
  APPROVAL: "brass",
  HOLD: "danger",
  BUDGET_OVERRUN: "warning",
  COLLECTIONS: "warning",
};

export default function NotificationsPage() {
  const { data: notifications } = useApi<any[]>("/notifications", []);
  const { mutate } = useMutate();
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const unread = notifications.filter((n) => !n.is_read);
  const roleAddressed = notifications.filter((n) => n.recipient_role_code);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    notifications.forEach((n) => m.set(n.category, (m.get(n.category) ?? 0) + 1));
    return Array.from(m.entries());
  }, [notifications]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return notifications.filter((n) => {
      if (filter === "UNREAD" && n.is_read) return false;
      if (filter !== "ALL" && filter !== "UNREAD" && n.category !== filter)
        return false;
      return !q || n.message.toLowerCase().includes(q);
    });
  }, [notifications, filter, search]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Core Operations"
        title="Notifications"
        description="The in-app inbox. Everything the system needs to tell somebody arrives here, and the same message can also go out by email or text."
        actions={
          unread.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => mutate("/notifications/read-all", "POST")}
            >
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          )
        }
      />

      <SectionGuide
        what="A single inbox for everything the system generates — a ticket assigned to you, an invoice put on hold, a budget approaching its limit, a purchase order needing your approval, a scheduled job finishing."
        who="Every staff member has one. Residents have their own version inside the portal. Vendors do not — they have no account, which is the gap discussed on the Roles &amp; Flow screen."
        how={[
          "A message can be addressed to one named person — 'this ticket is yours'.",
          "Or to everyone holding a role — 'the board packet is ready' reaches every board member without naming them.",
          "Or to the whole community as an announcement.",
          "Each message links back to the record it concerns, so one click opens the invoice or ticket in question.",
          "Addressing by role rather than by name is the important part: notifications keep working when staff change.",
        ]}
        flow="Every other section writes into this one. Try it — assign a vendor on a Service Desk ticket, then watch the count on the bell in the header go up."
      />

      <StatGrid>
        <StatCard label="Total messages" value={notifications.length} icon={Inbox} />
        <StatCard
          label="Unread"
          value={unread.length}
          tone={unread.length ? "primary" : "success"}
          icon={Bell}
        />
        <StatCard
          label="Addressed to a role"
          value={roleAddressed.length}
          hint="Reach everyone holding it"
          icon={Users}
        />
        <StatCard label="Categories in use" value={categories.length} />
      </StatGrid>

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search messages…"
        filters={
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "All", count: notifications.length },
              { value: "UNREAD", label: "Unread", count: unread.length },
              ...categories.map(([c, n]) => ({
                value: c,
                label: c.replace(/_/g, " ").toLowerCase(),
                count: n,
              })),
            ]}
          />
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="Nothing here"
          description={
            filter === "UNREAD"
              ? "Everything has been read."
              : "No messages match this filter."
          }
        />
      ) : (
        <Card padded={false}>
          <div className="divide-y">
            {filtered.map((n) => (
              <button
                key={n.id}
                onClick={() =>
                  !n.is_read && mutate(`/notifications/${n.id}/read`, "POST")
                }
                className={cn(
                  "flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50",
                  !n.is_read && "bg-primary/[0.05]"
                )}
              >
                <span
                  className={cn(
                    "mt-2 h-2 w-2 shrink-0 rounded-full",
                    n.is_read ? "bg-border" : "bg-primary"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-snug",
                      !n.is_read && "font-medium"
                    )}
                  >
                    {n.message}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone={(CATEGORY_TONE[n.category] ?? "neutral") as any}>
                      {n.category.replace(/_/g, " ")}
                    </Badge>
                    {n.recipient_role_code && (
                      <Badge tone="primary">
                        to all {n.recipient_role_code.replace(/_/g, " ").toLowerCase()}s
                      </Badge>
                    )}
                    {n.entity_type && (
                      <span className="font-mono text-2xs text-muted-foreground">
                        {n.entity_type}
                      </span>
                    )}
                    <span className="text-2xs text-muted-foreground">
                      {relTime(n.created_at)} · {shortDate(n.created_at)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </PageShell>
  );
}
