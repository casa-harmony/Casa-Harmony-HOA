# Review mode

A commenting layer over the demo, for the client to mark up the UI in place:
click a spot on any screen, a numbered dot appears there, and the dot holds a
thread with text and file attachments.

It is off by default. Without the passcode — or without `REVIEW_PASSCODE` set at
all — the site makes no review requests, renders no review markup, and behaves
exactly like the plain mock.

## Using it

**Turn it on:** open the site with the passcode in the URL, once per browser:

```
https://<your-site>/?review=<passcode>
```

The passcode is exchanged for an httpOnly cookie that lasts 90 days, and the
parameter is stripped from the address bar. Every page after that shows the
review pill in the bottom-right corner.

**Leave a comment:** click the `+` in the pill, then click the exact place on
the page. Everything under the cursor highlights as you move, so you can see
what you are about to attach the comment to. A card opens — type, attach
screenshots or files, post. The card collapses to a numbered dot.

**Read one:** click the dot. The thread opens with replies, attachments, and
buttons to resolve (✓) or delete (🗑). Resolved dots turn green and are hidden
until you click the ✓ in the pill.

**The list:** the ☰ button lists every comment on this page and on every other
page, so nothing gets lost on a screen nobody revisits.

**Turn it off:** click "Review" in the pill. Dots, cards and buttons all
disappear and only a small toggle remains — useful when the client wants to
look at the design without markings on top of it. The ⇥ button leaves review
mode entirely on that browser (it clears the cookie; the link re-enables it).

## How a dot stays where it was put

A comment stores the CSS path of the element it was dropped on plus the
fraction across that element's box where the click landed — not raw x/y. On
every frame the element is re-measured and the dot is redrawn at the same
relative spot, so it survives scrolling, window resizing, a different screen
size, and the page re-rendering with different data.

If the element is genuinely gone (a section removed, a tab closed), the dot
falls back to the coordinates it was dropped at and dims slightly. The thread
still carries a text label — "Section · Cash on hand" — so it stays meaningful
even then.

## Setup

Three environment variables in the Netlify UI (Site configuration →
Environment variables), and locally in `frontend-mock/.env.local`:

| Variable | What it is |
| --- | --- |
| `REVIEW_PASSCODE` | Any string. This is what unlocks review mode. Leave unset to disable the feature completely. |
| `DATABASE_URL` | Postgres connection string — Neon, or Supabase's pooler. Tables are created on first use. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | For attachments. `CLOUDINARY_URL` alone works too. |

Nothing else needs configuring; the schema (`review_pins`, `review_messages`,
`review_attachments`) is created automatically the first time a comment is read
or written.

**Degraded modes.** Without `DATABASE_URL`, comments save to that browser's
localStorage and a warning says so — handy for a local trial before a database
exists. Without Cloudinary, images under 1.5 MB are inlined and anything larger
is refused with a clear message.

## How it is wired

| Path | Role |
| --- | --- |
| `components/review/` | The whole client layer: provider, dots, thread card, pill. Mounted by one line in `app/layout.tsx`. |
| `lib/review/anchor.ts` | Turning a click into a re-findable element, and back. |
| `lib/review/client.ts` | Browser data access, remote and localStorage backends behind one interface. |
| `lib/review/repo.ts` | Server-side queries and payload validation. |
| `app/api/review/*` | Unlock, pins, messages, and the Cloudinary upload signature. |

Files never pass through the server: the browser uploads straight to Cloudinary
with a short-lived signature scoped to the review folder, which keeps the API
secret server-side and large uploads out of the serverless function.
