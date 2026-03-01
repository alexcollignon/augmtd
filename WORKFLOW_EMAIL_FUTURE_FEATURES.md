These are exactly the right directions — they all point toward the same thing: the product stops being a viewer and becomes an operator. Let me  
  think through each one and add what I think is missing.                                                                                          
                                                                                                                                                   
  ---                                                                                                                                              
  1. Pre-built workflow when an email arrives                                                                                                      
                                                                                                                                                   
  This is the most natural evolution of what's already there. Right now the email sync creates an inbox item with a WorkflowSeed — a description   
  and a prompt. When the user clicks "Open in workflow" it creates a thread and sends the first message, which then triggers planning from scratch.

  The improvement: run the planning AI at sync time, not at open time. When an email comes in and is_executable is true, the sync pipeline fires
  the planning AI immediately, stores the full ExecutionPlan on the thread (or pre-creates the thread), and when the user opens the workflow the
  plan is already there — no waiting, no first-message round trip.

  From the user's perspective: they open the workflow and see a fully formed plan waiting for review, not a blank chat. The "open in workflow"
  button becomes "review plan" — a fundamentally different mental model. The AI prepared the work, they validate and approve it.

  This fits the core vision perfectly. The cognitive cost framework says AUGMTD should do the preparation — this makes that literal.

  ---
  2. "Send to XYZ" from inside a workflow

  This closes the loop that's currently open. You generate a client proposal, download it, open your email client, compose a new email, attach the
  file. That's four context switches for something the system already has everything to do.

  In workflow chat, the user types "send this to alex@client.com with a note saying it's ready for review." The system:
  1. Drafts the email body using the document context (it knows what it just built)
  2. Attaches the artifact from Supabase Storage
  3. Shows a preview in the chat ("here's the email I'll send — confirm?")
  4. On confirm, sends via the connected Gmail/Outlook account

  This turns the workflow from a generation tool into a delivery tool. The document doesn't just exist in storage — it moves to where it needs to
  go. For a consultant this is the entire point: the deliverable reaches the client.

  The infrastructure for this mostly exists — you have sendGmailReply / sendOutlookReply, attachment storage, and the connected account. The main
  new piece is: composing a new email (not a reply) with an attachment from storage.

  ---
  3. Natural language inbox control

  This is the biggest shift in how the product feels. Right now the inbox is read-only from the user's perspective — they can send replies,
  confirm/reject items, open workflows, but they can't operate on the inbox itself conversationally.

  A persistent chat input on the inbox screen that can:
  - Send: "Send the drafted reply to the board meeting thread"
  - Snooze/defer: "Remind me about the contract review on Monday"
  - Filter/find: "Show me everything from clients this week"
  - Bulk action: "Mark all the newsletters as awareness"
  - Escalate: "Flag the contract from Dumont as urgent"
  - Create: "Draft a follow-up to the Johnson proposal from last Tuesday"

  This is different from a search bar — it's an agent that has full context of your inbox state and can take actions. The inbox becomes something
  you talk to, not something you scroll through.

  The key technical piece missing is an action resolver — a layer that maps natural language intent to specific inbox operations (update, send,
  filter, create thread). The inbox data is already there, the email send is already there, the gap is the orchestration layer.

  ---
  What I'd add that you didn't mention

  4. Proactive morning brief
  The product claims to prepare your next steps — but currently only when you open it. A scheduled (e.g. 8am) digest that runs through your inbox,
  identifies what needs action today, pre-runs planning on the top 2-3 executable items, and sends you a structured summary. You open AUGMTD and
  your day is already organized.

  This is a cron job that already has most of the infrastructure. The sync already runs on schedule. You'd add a "daily prep" pass on top of it.

  5. Thread continuity across email and workflow
  Right now email threads and work threads are separate. If a client emails asking for a revision to a proposal you built in the workflow system,
  there's no link. You'd handle the email in the inbox, then manually go back to the workflow to regenerate.

  The system should detect that an incoming email is about an existing work thread (by client, by subject, by reference) and surface the
  connection: "This looks related to your Q1 Proposal workflow — open it?" This is relationship graph territory — the context_profiles system
  already tracks relationships, it just doesn't connect them to work threads yet.

  6. Delegation awareness
  For boutique consulting, work often flows through a small team. The forwarding detection already exists. But there's no concept of "I'm
  forwarding this to my associate — AUGMTD should prepare a brief for them, not a reply for me." The AI currently treats forwarded emails as just
  context. It could instead switch to delegation mode: draft instructions for the person being delegated to, attach relevant context, make it easy
  to forward with a proper brief.

  ---
  How they connect

  All of these point to the same architectural gap: the inbox and the workflow are two separate islands. Email arrives → inbox. You decide to act →
   workflow. You produce something → download. You send it → separate email client.

  The product should be one continuous loop:
  email arrives → plan prepared → user approves → AI executes → output delivered → follow-up tracked

  Right now you have the first two and the middle one. The delivery and follow-up tracking are missing. The natural language inbox control is what
  makes the whole loop feel coherent from the user's side — instead of navigating between panels, they just talk to the system and it moves things.

  What's the priority for you — the pre-built workflow on email arrival, the send-from-workflow feature, or the inbox natural language control?