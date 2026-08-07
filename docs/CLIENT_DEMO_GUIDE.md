# Client Demo Guide — Casa Harmony front-end

How to run the demo, what to say, and what to do when the client pushes back.

---

## Before the call

```bash
cd frontend-mock && npm run dev
```

Opens on <http://localhost:3000>.

**Two minutes of setup:**

1. Click **Reset demo** in the header. This wipes anything left over from a
   previous run so the numbers are the ones you rehearsed.
2. Pick your theme with the sun / monitor / moon control in the header. Dark
   mode presents better on a projector; light mode is better on a shared screen
   in a bright room. Both are fully designed — switch freely.
3. Sign in as **Jane Okafor (HOA Admin)** in **Sunnyvale Gardens**.

**One thing to know before you start:** everything in this demo is real
front-end behaviour running in the browser. There is no server. If you create a
ticket it stays created; if you refresh, it is still there. Reset demo puts it
back.

---

## The 12-minute walkthrough

This sequence builds one story. Don't jump around — each step sets up the next.

### 1. The sign-in screen (1 min) — *the access model, before they even log in*

Don't rush past this. It is the best explanation of the product you have.

> "Before we go in — this is who uses the system. Watch the right-hand side as
> I change the role."

Open the dropdown and move between **Jane Okafor (HOA Admin)** and **David Lin
(Accountant)**. The whole right panel re-renders: the screens they can open, what
they can do, what they cannot.

**Say this:** *"One person, one password, but their powers are granted per
community. Jane manages Sunnyvale. David keeps the books for Sunnyvale and
Pinecrest. Same login screen, completely different application."*

Enter as **Jane**.

### 2. Dashboard (1 min) — *what needs attention today*

> "This is the first thing a property manager sees. Not a report — a to-do list."

Point at the three attention cards: open tickets, things waiting for approval,
invoices on hold. Each one is clickable and goes to the filtered list behind it.

**If they ask about the numbers:** they are live counts from this community. Show
them the community switcher in a moment and they change entirely.

### 3. Service Desk → the full money-out cycle (4 min) — *the centrepiece*

This is the part that sells the product. Take your time.

1. Open **Service Desk**. Click **"What is this screen, and how does it work?"**
   — every screen has this. Leave it open for a second so they see it exists,
   then collapse it.
2. Click the **"Elevator stuck between floors"** ticket (or any maintenance one).
3. In the drawer, walk down: the resident who reported it, the priority, the
   conversation thread, the attachment area.
4. **Drop a photo onto the attachment zone.** It appears immediately. Say:
   *"That is a real file picker. In the live product the bytes go to encrypted
   storage; here it stays in your browser."*
5. Click **Assign vendor** → choose a vendor → set an estimate → **Assign**.
6. **Now point at the bell in the header — the unread count has gone up.**
   Open it. The assignment is in the inbox.

   **Say this:** *"That is the notification model working. A message can go to
   one named person, or to everyone holding a role — so 'the board packet is
   ready' reaches every board member without naming them."*

7. Click **Raise purchase order**. A PO is created and submitted for approval.
8. Point at the green panel: *"The link is two-way. The order knows it came from
   this ticket, and the ticket knows the order's approval status — you never have
   to go looking."*

### 4. Payables → the three-way match (2 min) — *the financial control*

Open **Payables**. Filter to **On hold**. Open a held invoice.

Show the three-way match panel — ordered / received / invoiced.

**Say this:** *"This is the control that stops a community paying for work it
never received. The order, the delivery record and the invoice have to agree
within a tolerance you set. This one doesn't, so it was flagged automatically and
it cannot be paid until a person releases it and says why."*

Click **Release hold**, then **Submit for approval**. It moves.

### 5. The role switch (2 min) — *the moment that lands hardest*

Header, top right → switch to **David Lin (Accountant)**.

**Stop talking for two seconds and let them look at the sidebar.**

Then:

> "Service Desk is gone. Residents is gone. Users and Roles is gone. David keeps
> the books — he can enter an invoice, but look —"

Go to the dashboard. The approvals card now reads **"You can see these but not
approve them."**

> "He prepares the payment. He cannot authorise it. The person who enters a bill
> is structurally not the person who approves paying it. That's separation of
> duties, and it's the first thing an auditor asks about."

Now switch to **Tom Fairbanks (Viewer)** and let them see how little is left.

**Say this:** *"And this is a gap we want to discuss — the read-only role as
built is too narrow to give a board member. We've proposed a Board Member role;
it's on the Roles and Flow screen."*

### 6. Multi-community (1 min)

Switch back to **Morgan Reyes (Sysadmin)** — she has all three.

Use the community switcher: **Sunnyvale Gardens → Pinecrest Towers**.

Every number changes. Different units, different vendors, different tickets,
different money.

> "One system, three communities, completely sealed off from each other. That
> separation is enforced twice — once in the application, once in the database
> itself, so a bug in our code still can't leak one community's data into
> another."

### 7. Roles, Access & Operating Flow (1 min) — *hand them the homework*

Open it from the sidebar under **Reference**.

> "Everything I've just shown you is documented here, and it's in the app so
> it's never out of date. The cast, what every role can reach, both business
> cycles, how approvals work, and which flows go both ways. At the bottom are
> six decisions we need from you. Have a read after this call."

Scroll to the bottom and show the **vendor participation** options — A, B, C.

**This is the most important conversation of the project.** See below.

---

## The vendor question — how to handle it

They will ask, in some form: *"So when I assign a job to a plumber, does he get
it?"*

**Do not say yes.** The honest answer is the one that protects the budget.

> "Right now, no — and the reason matters. A notification is addressed to a user
> account, and a vendor doesn't have one. There's no login, no password, no
> portal. So there's nothing to deliver to."
>
> "That's a decision, not a bug, and there are three options."

Then walk the three cards on the Roles & Flow screen:

| | What the vendor gets | Cost |
|---|---|---|
| **A. Email only** | An email with a link to a read-only work order | Small |
| **B. Vendor portal** | Their own login — accept jobs, upload photos, submit invoices | **Large** |
| **C. Internal only** | Nothing; the notification goes to the staff owner | Mostly built |

**Recommend C now, B as a separate phase.** Say plainly:

> "Option B is a third login system alongside staff and residents. It's a real
> piece of work and we'd want to quote it separately rather than absorb it. If
> it matters to you, let's scope it properly."

---

## Questions you will get, and the answers

**"Is this the real system?"**
> "This is the real interface running on demonstration data, with no server
> behind it. The server side is largely built — the accounting engine,
> permissions and data isolation all exist. What you're looking at is the
> front-end, which is what we want your sign-off on before we connect the two."

**"Can we change the wording?"**
> "Yes, and we should. The word 'tenant' in particular — internally it means one
> community, not a renter. Tell us the words your staff actually use."

**"What happens if someone makes a mistake?"**
> "Depends where. Operational records — tickets, orders before approval,
> invoices — can be corrected freely. Anything that has posted to the ledger
> cannot; you correct it with a new dated entry. And once a month is closed, its
> numbers are frozen. That's deliberate — it's what makes the financial
> statements defensible."

**"Can residents see this?"**
> "No. Residents have a completely separate portal showing only their own units.
> That portal is the one piece not yet in this demo build — it's on our list."

**"How long until it's live?"**
> Don't answer with a date. Answer with the sequence: *"Sign-off on this flow →
> we connect the front-end to the server module by module → we run your data
> through the go-live checklist. The checklist is in the app — take a look at
> the Go-Live screen."*

---

## Known gaps — say these before they find them

Being upfront about these buys credibility for everything else.

1. **The resident portal doesn't open in this build.** It bypasses the demo data
   layer. It exists in the real front-end.
2. **Vendors have no login.** Covered above.
3. **The Board Member role is proposed, not built.** The server already sends
   notifications to it but the role was never defined.
4. **Approval thresholds are placeholders.** We need their real spending policy.
5. **Downloads produce a placeholder file.** No server, so no real PDF.

---

## What not to do

- **Don't demo on a fresh browser without clicking Reset demo first.** Leftover
  state from rehearsal will confuse you mid-sentence.
- **Don't open every sidebar item.** The client named their priorities —
  dashboard, service desk, residents, documents, notifications, vendors,
  payables, payments, and the admin screens. The rest are built but are not the
  story.
- **Don't promise the vendor portal.** See above.
- **Don't say "just" about anything.** Every "we can just add that" becomes a
  fixed-price expectation.

---

## After the call — what we need back

Send them the **Roles, Access & Operating Flow** screen (or the shared artifact
link) and ask for six answers:

1. How should vendors participate — A, B or C?
2. Should board members get a proper role, and what should they see?
3. What are the real approval thresholds?
4. Budget control: advisory (warn) or absolute (block)?
5. What invoice-matching tolerance, and is a delivery record always required?
6. What wording should the screens use?

Until those are answered, further build is guesswork.
