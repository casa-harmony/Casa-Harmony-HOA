"use client";

/**
 * Test Inbox — everything the application tried to send.
 *
 * Testing an invite, a password reset or an OTP normally needs a real mailbox
 * per test account. This screen removes that: every outbound email and SMS is
 * captured server-side and read back here with its link or code pulled out and
 * ready to copy.
 *
 * The bodies contain live tokens, which is exactly why the API behind this is
 * SUPERADMIN-only and off in production by default.
 */

import { useMemo, useState } from "react";
import { Copy, Check, Inbox, Mail, MessageSquare, RefreshCw, Trash2 } from "lucide-react";
import { useApi, useMutate } from "@/lib/use-api";
import { Badge, Button, Card } from "@/components/ui";
import {
  DataTable, DetailSheet, EmptyState, FilterChips, PageHeader, PageShell,
  SectionGuide, StatCard, StatGrid, StatusBadge, Toolbar, relTime,
} from "@/components/app/kit";
import type { Column } from "@/components/app/kit";

interface Message {
  id: string;
  channel: "EMAIL" | "SMS";
  to_address: string;
  subject: string | null;
  status: string;
  tenant_id: string | null;
  is_sandbox: boolean;
  created_at: string;
  preview: string;
}

interface MessageDetail extends Message {
  body: string;
  detail: string | null;
  links: string[];
  codes: string[];
}

/** What each capture status means, in the tester's terms rather than the code's. */
const STATUS_HELP: Record<string, string> = {
  SENT: "Handed to the mail provider — this one really went out.",
  SUPPRESSED: "Sandbox login, so it was deliberately not sent. Read it here instead.",
  NO_PROVIDER: "No mail provider configured, so it was only captured.",
  FAILED: "The provider rejected it. See the detail below.",
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      className="h-8 shrink-0 px-2 text-xs"
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="ml-1.5">{copied ? "Copied" : label}</span>
    </Button>
  );
}

export default function InboxPage() {
  const { data: messages, loading, error, reload } = useApi<Message[]>("/dev-mailbox", []);
  const { mutate, busy } = useMutate();
  const [channel, setChannel] = useState("ALL");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: detail } = useApi<MessageDetail | null>(
    openId ? `/dev-mailbox/${openId}` : null,
    null
  );

  const emails = messages.filter((m) => m.channel === "EMAIL").length;
  const sms = messages.filter((m) => m.channel === "SMS").length;
  const failed = messages.filter((m) => m.status === "FAILED").length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return messages.filter((m) => {
      if (channel !== "ALL" && m.channel !== channel) return false;
      if (!q) return true;
      return (
        m.to_address.toLowerCase().includes(q) ||
        (m.subject ?? "").toLowerCase().includes(q) ||
        m.preview.toLowerCase().includes(q)
      );
    });
  }, [messages, channel, search]);

  const columns: Column<Message>[] = [
    {
      key: "channel",
      header: "",
      className: "w-10",
      render: (m) =>
        m.channel === "EMAIL" ? (
          <Mail className="h-4 w-4 text-muted-foreground" />
        ) : (
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        ),
    },
    {
      key: "to",
      header: "To",
      className: "whitespace-nowrap",
      render: (m) => <span className="font-medium">{m.to_address}</span>,
    },
    {
      key: "subject",
      header: "Subject",
      // max-w-0 with w-full is the auto-layout table trick that makes the child
      // `truncate` actually bite — without it a long preview pushes Status and
      // Received off the right edge.
      className: "w-full max-w-0",
      render: (m) => (
        <div className="min-w-0">
          <p className="truncate text-foreground">{m.subject ?? "(SMS)"}</p>
          <p className="truncate text-xs text-muted-foreground">{m.preview}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (m) => <StatusBadge status={m.status} /> },
    {
      key: "when",
      header: "Received",
      render: (m) => (
        <span className="whitespace-nowrap text-muted-foreground">{relTime(m.created_at)}</span>
      ),
    },
  ];

  async function clearAll() {
    await mutate("/dev-mailbox/clear", "POST");
    setOpenId(null);
    reload();
  }

  async function deleteOne(id: string) {
    await mutate(`/dev-mailbox/${id}`, "DELETE");
    setOpenId(null);
    reload();
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Testing"
        title="Test Inbox"
        description="Every email and SMS the application tried to send, captured so you can grab an invite link or an OTP without a real mailbox."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={reload}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={clearAll}
              disabled={!messages.length || busy === "/dev-mailbox/clear"}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear inbox
            </Button>
          </div>
        }
      />

      <SectionGuide
        what="Everything the application tried to send — resident invites, staff password resets and one-time codes — captured so you can read it without owning a real mailbox for every test account."
        who="Platform administrators. The message bodies contain live tokens, so the screen is SUPERADMIN-only and switched off in production by default."
        how={[
          "Trigger something that sends mail: invite a resident, create a staff user, or use “Forgot password”.",
          "The message appears here within seconds — refresh if you beat it to the screen.",
          "Open it and copy the link or the code straight out of the panel.",
          "Messages are captured whether they were really sent, suppressed because you are on a sandbox login, or only logged because no mail provider is configured.",
        ]}
        flow="Sandbox and live captures are kept apart by the same partition that separates the communities, so a developer never reads a real resident's reset token."
      />

      <StatGrid>
        <StatCard label="Messages" value={String(messages.length)} icon={Inbox} />
        <StatCard label="Emails" value={String(emails)} icon={Mail} />
        <StatCard label="SMS" value={String(sms)} icon={MessageSquare} />
        <StatCard label="Failed" value={String(failed)} tone={failed ? "danger" : "default"} />
      </StatGrid>

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search recipient, subject or body…"
        filters={
          <FilterChips
            value={channel}
            onChange={setChannel}
            options={[
              { value: "ALL", label: "All", count: messages.length },
              { value: "EMAIL", label: "Email", count: emails },
              { value: "SMS", label: "SMS", count: sms },
            ]}
          />
        }
      />

      {error ? (
        <EmptyState
          icon={Inbox}
          title="The inbox is unavailable"
          description={
            error.includes("disabled") || error.includes("404")
              ? "Capture is turned off. Set DEV_MAILBOX_ENABLED=true on the API to switch it on."
              : error
          }
        />
      ) : (
        <Card className="p-0">
          <DataTable
            rows={filtered}
            columns={columns}
            onRowClick={(m) => setOpenId(m.id)}
            empty={
              <EmptyState
                icon={Inbox}
                title={loading ? "Loading…" : "No messages yet"}
                description="Trigger something that sends mail — invite a resident, or use “Forgot password” — and it will appear here."
              />
            }
          />
        </Card>
      )}

      <DetailSheet
        open={!!openId && !!detail}
        onClose={() => setOpenId(null)}
        title={detail?.subject ?? "Message"}
        subtitle={detail ? `To ${detail.to_address} · ${relTime(detail.created_at)}` : undefined}
        badge={detail ? <StatusBadge status={detail.status} /> : undefined}
        footer={
          detail ? (
            <Button variant="outline" onClick={() => deleteOne(detail.id)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete message
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              {STATUS_HELP[detail.status] ?? detail.status}
            </p>

            {detail.detail && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                  Provider detail
                </p>
                <p className="mt-1 break-all font-mono text-xs">{detail.detail}</p>
              </div>
            )}

            {detail.links.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Links
                </p>
                <div className="space-y-2">
                  {detail.links.map((link) => (
                    <div key={link} className="flex items-start gap-2 rounded-lg border p-2">
                      <p className="min-w-0 flex-1 break-all font-mono text-xs">{link}</p>
                      <CopyButton value={link} label="Copy" />
                      <Button
                        variant="outline"
                        className="h-8 shrink-0 px-2 text-xs"
                        onClick={() => window.open(link, "_blank")}
                      >
                        Open
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.codes.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Codes
                </p>
                <div className="flex flex-wrap gap-2">
                  {detail.codes.map((code) => (
                    <div key={code} className="flex items-center gap-2 rounded-lg border p-2">
                      <span className="font-mono text-lg font-semibold tracking-widest">
                        {code}
                      </span>
                      <CopyButton value={code} label="Copy" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Message body
              </p>
              <pre className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {detail.body}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge tone={detail.is_sandbox ? "brass" : "neutral"}>
                {detail.is_sandbox ? "Sandbox" : "Live"}
              </Badge>
              <Badge tone="neutral">{detail.channel}</Badge>
            </div>
          </div>
        )}
      </DetailSheet>
    </PageShell>
  );
}
