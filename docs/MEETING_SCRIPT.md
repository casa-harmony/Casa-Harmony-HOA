# Client Meeting Script

Read this during the call. **Bold** = what you do. Quoted text = roughly what you say.

Total: about 20 minutes plus questions.

---

## Before you dial in (5 minutes)

```bash
cd frontend-mock && npm run dev
```

- [ ] Open <http://localhost:3000/login>
- [ ] Click **Reset demo** once you are inside, then come back to the login screen
- [ ] Set the theme — **light** for a bright room, **dark** for a projector
- [ ] Have a photo file on your desktop ready to drag (any JPG)
- [ ] Open a second browser tab at <http://localhost:3000/portal/login> — you will
      switch to it near the end
- [ ] Close every other tab. Share only the browser window.

---

# PART 1 — Who uses this (3 min)

### Step 1 · Start on the login screen. Do not sign in yet.

> "Before I show you the product, I want to show you the people. Everything in
> this system is shaped by who is looking at it."

**Open the "Sign in as" dropdown. Do not pick anything yet — just let them see
the list.**

> "Six kinds of staff, and separately, residents. Watch the right-hand panel as
> I move between them."

### Step 2 · Select **Jane Okafor — Property Manager**.

**Point at the right panel.**

> "Jane runs one community day to day. She can reach almost every screen, she
> approves spending, she manages the residents."

### Step 3 · Now select **David Lin — Controller**.

**Let the panel re-render. Pause. Point at the struck-through items.**

> "David keeps the books. Service Desk is gone. Residents is gone. Users and
> Roles is gone. And look at the bottom right —"

**Point at "What they cannot do".**

> "He cannot approve a purchase order or an invoice. He prepares the payment; he
> does not authorise it. That is separation of duties, and it is the first thing
> an auditor asks about."

### Step 4 · Select **Tom Fairbanks — External Auditor**.

> "And this is a gap I want your opinion on. Our read-only role currently sees
> almost nothing. If you want board members to log in and read the finances
> without changing anything, we need to define a proper Board Member role. It is
> a small piece of work but I need your sign-off on what they should see."

### Step 5 · Go back to **Jane Okafor**, community **Sunnyvale Gardens**. Click **Enter the application**.

---

# PART 2 — A day in the life (4 min)

### Step 6 · You land on the Dashboard.

> "This is what Jane sees first. Not a report — a list of what needs her
> attention today."

**Point at the three cards: open tickets, waiting for approval, invoices on hold.**

> "Every one of these is clickable and takes her to the list behind the number."

### Step 7 · Scroll down to the charts.

> "Underneath, the numbers over time. Cash for the next six months, how long
> money has been owed, and spending against budget."

**Hover over the cash line so the tooltip appears.**

> "Everything is hoverable."

**Click the small table icon in the top-right of any chart.**

> "And every chart has the raw numbers behind it, one click away — because
> accountants want the figures, not the picture."

**Click it again to go back to the chart.**

### Step 8 · Click the info bar: "What is this screen, and how does it work?"

> "Every single screen in the product has this. What it is, who uses it, how it
> works step by step, and what it connects to. Your staff can train themselves."

**Collapse it again.**

---

# PART 3 — The core cycle: a leak becomes a paid bill (6 min)

*This is the most important part of the meeting. Do not rush it.*

### Step 9 · Click **Service Desk** in the sidebar.

> "This is where problems arrive. A resident reports a leak from their phone, or
> your office logs a complaint."

**Point at the two charts.**

> "What people are reporting, and where the work stands."

### Step 10 · Click the ticket **"Elevator stuck between floors"** (or any maintenance one).

**The panel slides in from the right.**

> "Who reported it, which unit, the priority, and the whole conversation
> underneath."

### Step 11 · Drag your photo onto the attachment area.

> "Real file handling. In the live product that goes to encrypted storage and
> every download is permission-checked and logged."

### Step 12 · Click **Assign vendor** → pick a vendor → type an estimate → **Assign**.

**Now stop and point at the bell icon in the top bar. The number has gone up.**

> "That is the notification system. It just posted to the inbox."

**Click the bell. Show the message. Close it.**

> "A message can go to one named person, or to everyone holding a role — so 'the
> board packet is ready' reaches every board member without naming anybody."

### Step 13 · Back in the ticket panel, click **Raise purchase order**.

> "The ticket has just become a commitment to spend. It has gone into the
> approval chain, and how many people have to sign depends on the amount."

**Point at the green box that appears.**

> "And the link runs both ways. The order knows it came from this ticket, and
> the ticket now shows the order's approval status — nobody has to go hunting."

### Step 14 · Click **Payables** in the sidebar. Filter to **On hold**. Open a held invoice.

**Point at the three boxes: Ordered / Received / Invoiced.**

> "This is the control that stops you paying for work you never received. The
> order, the delivery record and the invoice all have to agree, within a
> tolerance you set. This one doesn't — so the system flagged it and it cannot
> be paid until a person releases it and says why."

### Step 15 · Click **Release hold**, then **Submit for approval**.

> "Released, with a reason on the record. Now it goes for approval."

---

# PART 4 — Same system, different eyes (4 min)

### Step 16 · Top right — switch to **David Lin (Accountant)**.

**Say nothing for two seconds. Let them look at the sidebar.**

> "Same system. Same community. Service Desk gone, Residents gone, Users gone."

**Go to the Dashboard. Point at the approvals card.**

> "And it now says 'You can see these but not approve them.' He prepares, someone
> else authorises."

### Step 17 · Switch to **Morgan Reyes (Regional Director)**.

**Use the community switcher in the top-left: Sunnyvale Gardens → Pinecrest Towers.**

> "Morgan covers all three communities. Watch every number change."

**Let it load. Point at the totals.**

> "Different units, different vendors, different money, different tickets. One
> system, three communities, completely sealed off from each other — and that
> separation is enforced twice: once in the application and once in the database
> itself, so a bug in our code still cannot leak one community's data into
> another."

### Step 18 · Open **Board Dashboard** from the sidebar.

> "And this is what your board sees each month. Written for volunteers, not
> accountants. Cash split by fund, how long money has been owed, spending
> against budget, and a six-month forecast."

> "All of it is assembled into a board packet and emailed automatically on the
> fifth of every month — nobody has to remember."

---

# PART 5 — What the homeowner sees (2 min)

### Step 19 · Switch to your second browser tab: `/portal/login`.

> "Completely separate application, separate login, separate door."

**Pick a resident with more than one unit if there is one. Click Sign in.**

> "This is a homeowner. Their balance, what is due next, their assessment
> history, their payment history, documents shared with them — and the ability
> to report a problem, which lands straight on the service desk we were just
> looking at."

### Step 20 · Click **My requests → Report something**. Fill it in. Submit.

> "That ticket is now in your office's queue."

**Scroll to the bottom of the portal.**

> "And this is the important part — what they cannot see. Any other unit, any
> other resident, the community's overall finances, vendor contracts, anything
> at all in the staff application."

---

# PART 6 — The reference and the decisions (3 min)

### Step 21 · Back in the staff tab. Sidebar → **Roles, Access & Flow**.

> "Everything I have just shown you is documented here, inside the application,
> so it can never go out of date. Who every role is, exactly what each can
> reach, both business cycles, how approvals work, and which flows travel in
> both directions."

**Scroll to section 5 — the flow direction table.**

> "This one matters. It says which things can be corrected later and which
> cannot. Operational records — tickets, orders before approval — you can fix
> freely. Anything that has posted to the ledger, you cannot. You correct it
> with a new dated entry. That is what makes your financial statements
> defensible."

### Step 22 · Scroll to section 6 — the decisions.

> "And I need six answers from you before we build further."

**Read the vendor options aloud from the screen — A, B, C.**

> "This is the big one. Right now a vendor has no login, no password, no portal.
> So when you assign a job to a plumber, there is nowhere to deliver it. That is
> a decision, not a bug."

> "Option A is email only. Option B is a full vendor portal — that is a third
> login system alongside staff and residents, and I would want to quote that
> separately rather than absorb it. Option C is what we have: the notification
> goes to your staff member who owns the ticket."

> "My recommendation is C now, and if B matters to you, let us scope it
> properly as its own phase."

---

# Closing (1 min)

> "To be clear about what you have just seen: this is the real interface running
> on demonstration data. There is no server behind it today. The server side is
> largely built — the accounting engine, the permissions, the data separation
> all exist. What I wanted your sign-off on is the flow and the access model,
> because that is what everything else gets built on top of."

> "I will send you the Roles and Flow document. Six questions at the bottom. Once
> I have those answers we connect this front end to the server, module by
> module."

---

# Say these before they find them

Work these in naturally — being upfront buys credibility.

| Gap | How to say it |
|---|---|
| **Downloads give a placeholder file** | "No server today, so exports produce a stub. Against the live system that is a real PDF." |
| **Vendors have no login** | Covered in Part 6. Never gloss over it. |
| **Board Member role not built** | Covered in Part 1, Step 4. |
| **Approval amounts are placeholders** | "Those thresholds are made up. I need your actual spending policy." |

---

# Questions you will get

**"Is this real or a mockup?"**
> "The interface is real and it is the same code that will ship. The data behind
> it is demonstration data. The server is separately built — this meeting is
> about agreeing the flow before we join them."

**"Can we change the words?"**
> "Yes, and we should. 'Tenant' especially — internally that means one community,
> not a renter. Tell me the words your staff actually use and the screens will
> follow."

**"How long?"**
> Do not give a date. Give the sequence: *"Your sign-off on this flow, then we
> connect front end to server module by module, then your data goes through the
> go-live checklist — which is in the app, on the Go-Live screen."*

**"What if someone makes a mistake?"**
> "Depends where. Operational records can be corrected. Anything posted to the
> ledger cannot — you correct it with a new dated entry, and once a month is
> closed it is frozen. Deliberate. It is what makes the accounts trustworthy."

**"Can we add [X]?"**
> "Probably. Let me write it down and come back to you with what it involves."
> **Never say "we can just add that."**

---

# Do not

- Do not open every sidebar item. Stick to the script.
- Do not promise the vendor portal.
- Do not say "just" about any piece of work.
- Do not demo without clicking **Reset demo** first.
