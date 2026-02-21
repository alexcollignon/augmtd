 how does the system use the attachment in the different cases/flows? please explain. dont make edits                                             
                                                                                                                                                   
⏺ Let me read the key files to trace each flow accurately.                                                                                         
                                                                                                                                                   
⏺ Searched for 2 patterns, read 4 files (ctrl+o to expand)                                                                                         
                                                                                                                                                   
⏺ Now I have a complete picture. Here's how attachments flow through each case:                                                                    
                                                                                                                                                   
  ---                                                                                                                                              
  Flow 1: Email sync (Gmail/Outlook → inbox item)                                                                                                  
                                                                                                                                                   
  During sync (sync-emails.ts), after an email is stored:                                                                                          
  1. If parsed.attachments.length > 0 (Gmail) or parsed.hasAttachments (Outlook), processAttachmentsForEmail() runs                                
  2. Each attachment is downloaded from the provider API, text extracted via text-extractor.ts (PDF → pdf-parse, DOCX → mammoth, TXT →             
  buffer.toString(), everything else → null)
  3. The raw file buffer is uploaded to Supabase Storage at email-attachments/{userId}/{emailId}/{filename}
  4. A ProcessedAttachment object (filename, mimeType, size, storagePath, extractedText) is built — text truncated to 3000 chars

  The resulting array is stored in inbox_items.source_data.attachments on both create and update paths (lines 620 and 761).

  Important gap: The processEmail() AI call that generates the draft reply does NOT receive attachment text — it only sees the email body. So draft
   replies are currently unaware of what's in attached documents.

  ---
  Flow 2: "Open as Workflow" from an inbox item with email attachments

  When the user clicks the workflow button, open-workflow/route.ts:
  1. Reads item.source_data.attachments (the array from Flow 1)
  2. Builds a metadata-only blurb: "- contract.pdf (PDF, 45 KB)"
  3. Appends to the workflow prompt: "Available attachments (already provided — include each as an input with status "provided"):\n..."
  4. Returns this enriched prompt to the client

  The client sends it as the first chat message. The planning AI (messages/route.ts) has a system prompt rule that says: if the prompt mentions
  available attachments, create an input with status: "provided" and providedFilename set to the exact filename. The plan panel then shows those
  inputs as green with the filename shown.

  Full text is not injected here — planning prompts stay short.

  ---
  Flow 3: User uploads a file to a plan input (plan panel "Attach" button)

  Inside an active workflow thread:
  1. User clicks "Attach" on a pending input → file picker (PDF/DOCX/TXT, max 10 MB)
  2. POST /api/work/threads/{id}/attach with file + inputId
  3. The route extracts text (same extractor), uploads to email-attachments/{userId}/{threadId}/{inputId}-{filename}, saves to
  work_threads.user_attachments ({inputId, filename, mimeType, size, storagePath, extractedText})
  4. Marks the plan input as status: "provided", providedFilename: file.name in work_threads.plan
  5. Returns updated plan → client re-renders input as green

  Remove (✕) calls DELETE on the same route: file deleted from storage, user_attachments updated, plan input reset to pending.

  ---
  Flow 4: User attaches files on the entry ("Create Work") view

  Before a thread exists:
  1. Files are held in entryFiles: File[] React state — not uploaded yet
  2. On submit, startThread() creates the thread first, then:
    - Uploads each file to /api/work/threads/{newThreadId}/attach with inputId = file.name as a sentinel
    - Builds an enriched prompt: "{description}\n\nAttached files (already provided ...):\n- brief.pdf (PDF, 12 KB)"
  3. Sends the enriched prompt as the first chat message
  4. Planning AI creates provided inputs from the file names in the prompt

  Known quirk: The sentinel inputId is the filename. The AI generates its own IDs (input_1, input_2, etc.). So if the user later tries to remove
  one of these inputs from the plan panel, the DELETE call uses input_1 — which won't find the file in user_attachments (stored under the
  filename). The plan input resets to pending visually, but the file in Storage isn't deleted.

  ---
  Flow 5: Document generation (where full text is finally used)

  When the user clicks "Generate document", generate/route.ts:
  1. Fetches thread.user_attachments (user-uploaded, from Flows 3 and 4)
  2. Fetches linkedItem.source_data.attachments (email attachments, from Flow 1, if this thread came from an inbox item)
  3. Merges both arrays, filters those with extractedText, builds: "--- contract.pdf ---\n[up to 3000 chars of text]"
  4. Injects into Haiku's user prompt as ATTACHMENT CONTENT (use as source material)

  This is where the actual document text is used — Haiku reads the attachment content and incorporates it into the generated document.

  ---
  What's not yet built

  - UI for email attachments in inbox: Users can't see or download email attachments from the inbox item detail view. The download route
  (/api/inbox/[id]/attachment) doesn't exist — it was in the original plan but never implemented.
  - Draft replies don't see attachments: The AI that drafts your email reply (processEmail()) gets no attachment text, so it can't reference what's
   in an attached contract or brief.
  - Storage is never cleaned up: Email attachment files in email-attachments bucket are never deleted when inbox items or connections are removed.

✻ Worked for 1m 24s

❯ besides what you mentioned what are possible issues or things we missed that we need to consider for the attachments? don't make edits yet       
                                                                                                                                             
⏺ Read 1 file (ctrl+o to expand)                                                                                                                   
                                                                                                                                                   
⏺ Several issues worth knowing about, roughly by severity:
                                                                                                                                                   
  ---                                                                                                                             
  High — likely broken or data loss                                                                                                                
                                                                                                                                                   
  1. PDF extraction is almost certainly broken                                                                                                     
  text-extractor.ts uses const { PDFParse } = await import('pdf-parse'). The pdf-parse package is a default export function, not a named class.    
  PDFParse will be undefined, new PDFParse(...) throws a TypeError, the catch block swallows it and returns null. Every PDF silently produces no
  text. The correct API is pdfParse(buffer) as a default import.

  2. Update path overwrites previous attachments
  In the sync update path (existingInboxItem branch), processedAttachments is built from the newly stored email. If that new email has no
  attachments, processedAttachments is [], so attachments is undefined in the new source_data object. Supabase omits undefined fields from JSON —
  so the entire source_data gets written without an attachments key, silently deleting the attachment metadata from email 1 of the thread. Any
  thread that gets more than one email loses its attachments.

  3. Plan AI can silently reset provided inputs
  The attach route writes status: "provided" and providedFilename into work_threads.plan. When the user sends any follow-up chat message, the AI
  regenerates the full plan and messages/route.ts overwrites work_threads.plan with the AI's version. If the AI drops or resets the input's
  status/providedFilename (it's instructed to preserve them, but it's not guaranteed), the provided state is lost both in the DB and in React state
   — even though the file is still in user_attachments and Storage.

  ---
  Medium — functional gaps or incorrect behavior

  4. Inline images uploaded to Storage for every email
  Outlook's hasAttachments flag is true when email signatures contain embedded images (logos, etc.). These get downloaded, the extractor skips them
   (returns null), but they're still uploaded to Supabase Storage. Every email from a company with a logo in their signature creates useless
  storage objects. This also burns unnecessary API calls during sync.

  5. No size filter before downloading
  processAttachmentsForEmail downloads the full file buffer before checking what to do with it. There's no pre-download size guard on the metadata.
   Someone sending a 50MB video or recording as an attachment would cause the sync to download and re-upload 50MB to Storage even though it
  produces no extractable text.

  6. 3000-char truncation hides most of long documents
  Text is sliced to 3000 chars at sync time (and again in the plan-panel attach route). At generation time, Haiku receives truncated text — roughly
   2-3 pages of a contract. For legal/consulting use cases where the relevant clause might be on page 15, this is a real limitation. The truncation
   happens once at write time, so there's no option to inject more text later.

  7. Attachment metadata exposed in planning prompt but maybe absent at generation
  Email attachments in the workflow prompt say "already provided." The plan AI marks them as provided. But at generation time, generate/route.ts
  reads from linkedItem?.source_data?.attachments. If that was overwritten to empty by bug #2, Haiku receives no attachment content — but the plan
  still claims the input is provided. The plan lies.

  ---
  Low — edge cases and UX gaps

  8. Entry-view files carry into blueprint selection
  If a user attaches files, then clicks a blueprint card, handleBlueprintSelect calls startThread() which reads entryFiles from state. The
  blueprint description gets enriched with those files, which wasn't the user's intent.

  9. One file per input slot
  The attach route replaces any existing attachment for a given inputId. No way to attach multiple supporting documents to a single input (e.g.,
  two contracts that both inform one step).

  10. Entry-file inputId sentinel vs. AI-generated IDs
  Entry-view files are stored in user_attachments with inputId = file.name. The AI assigns its own IDs (input_1, input_2, etc.). The "remove"
  button on a plan input uses the AI ID, not the filename — so removing an entry-originated provided input won't find the file in user_attachments
  and won't delete it from Storage.

  11. Email attachment MIME type isn't validated against file extension
  Some email clients send attachments with wrong MIME types (e.g., a PDF as application/octet-stream). The extractor is MIME-type exclusive and has
   no filename extension fallback, so these are silently skipped.

  12. No visibility into email attachments from the inbox UI
  The download route (/api/inbox/[id]/attachment) was never built. The work-detail-panel has no attachments section. Users have no way to see or
  access email attachments from within the app — the files are in Storage but invisible to the UI entirely.

  ---
  The real priority order

  1, 2, and 3 affect correctness of existing data. 4 and 5 affect cost at scale. 12 is a visible gap. The rest are edge cases or MVP-acceptable
  shortcuts.

✻ Sautéed for 2m 19s                                                                                                                               
                                                                                                                                  
❯ ok, now another thing I want you to analyze. in the workflows, after a plan is done a a document is generated. what can a user do or not do      
  in terms of re-editing the plan, removing attachments, regenerate documents, etc.                                                                
                                                                                                                                                   
  I want to make sure it follows a UX that makes sense, and also not to give too much freedom to the user to allow anything and then it            
  doesn't work                                                                                                                                     
                                                                                                                                                   
  review the different possibilities there, and tell me what we have or don't have, and what would you suggest, given the goal of the tool.        
  don't make edits yet                                                                                                                             
                                                                                                                                                   
⏺ Searched for 3 patterns, read 2 files (ctrl+o to expand)                                                                                         
                                                                                                                                                   
⏺ Now I have the full picture. Let me map this out clearly.
                                                                                                                                                   
  ---                                                                                                                             
  What the current state machine looks like                                                                                                        
                                                                                                                                                   
  There are three modes: planning → generating → document. The transitions are:                                                                    
  - Planning → Generating: clicking "Generate document"                                                                                            
  - Generating → Document: generation completes                                 
  - Document → Planning: clicking "Back to plan" (React state only, artifact stays in DB)

  On thread load, always starts in planning mode. If an artifact exists, a "Document ready" banner shows at the top of the plan panel with a "View
  document →" link.

  ---
  What works well

  Planning mode (no artifact yet):
  - Chat refines the plan ✓
  - Attach / remove files on inputs ✓
  - Generate triggers full Haiku call with current plan + attachments ✓

  Document mode:
  - Targeted text edits via the chat input → edit-artifact → Haiku applies instruction to current artifact.content and regenerates the .docx ✓
  - Download .docx ✓
  - "Back to plan" to return to planning ✓

  Delete thread cleans up both the artifact from Storage and work_patterns ✓

  ---
  What's broken or missing

  1. No guard before overwriting a document with "Generate document"
  If the user is back in planning mode and presses "Generate document" again, it silently replaces the existing document. Any edits made via the
  edit flow are permanently lost. No confirmation, no warning.

  2. No stale-document signal
  If the user goes "Back to plan," modifies the plan through chat, attaches a new file, or removes an existing one — the document was generated
  from older state. The "Document ready" banner still looks the same. Nothing signals that the document and the plan have drifted. The user has no
  way of knowing their document doesn't reflect the current plan.

  3. Edit-artifact has no access to attachments
  The edit route reads thread.artifact (current document content) but doesn't load user_attachments or email attachments. So "add a section
  summarizing the contract we uploaded" from document mode won't work — Haiku can only work with what's already in the document text. Files are
  only used at full-generation time, not incremental edits.

  4. Plan chat in planning mode (with existing document) can silently diverge from document
  When the user goes back to planning and chats further, the messages route updates the plan. This doesn't touch the artifact at all. The user can
  hold an entire extended planning conversation after generation, further diverging plan from document, with no indication.

  5. Removing an attachment used in a generated document leaves no trace
  The plan input resets to pending, the file is deleted from Storage. But the document still contains content derived from that file. The content
  doesn't disappear, but the source does. No warning.

  6. No way to "sync document to current plan"
  After refinements in planning mode, the user has two options: "Generate document" (full regeneration, loses edits) or "Back to document" and use
  the edit chat. There's no action that says "regenerate incorporating my latest plan changes while preserving the edits I made." These two modes
  have no bridge.

  7. No conversation in document mode about the plan
  The chat input in document mode only calls editArtifact. There's no way to ask "what does the plan say about section 3?" or "should I add an
  appendix?" while looking at the document. It's edit-only.

  ---
  What I'd suggest for this tool's goal

  The target users are consultants and lawyers who are precise about versions. The UX should reflect that: once a document exists, it's a versioned
   artifact that you edit carefully — you don't accidentally regenerate it.

  Suggested model:

  - Lock "Generate document" once an artifact exists. Replace it with something like "Regenerate document (replaces current)" with a confirmation:
  "This will replace your current draft. Your manual edits will be lost." Make this clearly destructive.
  - Add a "Document may be outdated" state. Track a plan_hash or simply a plan_updated_after_artifact boolean. When the plan changes (any chat
  message in planning mode, any attach/remove) after an artifact exists, flip the flag. Show a different banner: "Plan changed since last
  generation — regenerate to update."
  - Restrict plan editing once a document exists — or make the consequence clear. Two approaches:
    - Soft: Allow editing but show the outdated banner prominently. Simple to implement.
    - Hard: Lock the plan panel (make it read-only) once in document mode. User must consciously go "Back to plan" to unblock edits, and doing so
  shows a modal: "You're editing the plan. The document will be marked as outdated."
  - Pass attachments through to edit-artifact. Small change: the edit route already has access to thread — it could also load user_attachments and
  inject text the same way the generate route does. This makes edits much more powerful.
  - Keep attach/remove available in both modes, but: if attaching or removing a file after a document exists, show an inline note: "Document may
  not reflect this change — regenerate to include."

  The core principle: generation is a gate, not a shortcut. Before generation, everything is fluid. After generation, changes are either targeted
  edits to the document or conscious regenerations. The UI should make that boundary obvious.