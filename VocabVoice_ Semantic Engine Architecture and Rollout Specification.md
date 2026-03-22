# **VocabVoice: Semantic Engine Architecture and Rollout Specification**

## **1\. Executive Decision**

The architectural foundation for the Sprint 6 semantic layer must resolve a fundamental conflict in system design: the synchronous, latency-sensitive requirements of an active conversational voice loop versus the computationally intensive, asynchronous requirements of deep semantic evaluation. The primary objective is the establishment of a robust, decoupled semantic engine that processes learner audio transcripts without degrading the instantaneous nature of the conversational sparring partner. The system must ingest raw transcript data, accurately detect the presence of target vocabulary using natural language processing heuristics, evaluate the semantic and syntactical correctness of the usage via a Large Language Model, and update the learner's spaced repetition state securely within the database.

To achieve this equilibrium, the architecture will strictly bifurcate into a synchronous conversational pipeline and an event-driven asynchronous semantic pipeline. The synchronous turn loop will retain exclusive responsibility for latency-sensitive operations. These include receiving the audio blob from the client, executing Speech-to-Text translation via Whisper-1, fetching conversational history, generating the conversational LLM response via GPT-4o-mini, synthesizing Text-to-Speech via TTS-1, and returning the audio to the client. This synchronous loop must remain entirely agnostic to the pedagogical evaluation process, keeping it strictly limited to transcription, response generation, persistence, and enqueuing.1

The asynchronous layer will execute entirely in the background after the conversational turn concludes. The recommended architecture leverages Supabase Queues natively via the pgmq extension as the durable job queue.1 Jobs are processed by a Supabase Edge Function worker which is invoked by Supabase Cron to dequeue batches of jobs using pgmq.read with a visibility timeout (VT).1 This guarantees execution, handles retries automatically, and completely removes evaluation latency from the user experience, while still utilizing robust atomic transactions via RPCs with row-level locking to ensure that "turn existence" and "job existence" are atomic.1

| Component | Execution Context | Primary Responsibility | Technological Implementation |
| :---- | :---- | :---- | :---- |
| **Conversational Loop** | Synchronous | Manage the live AI sparring partner dialogue. | Next.js API Routes, Whisper-1, GPT-4o-mini, TTS-1 |
| **Job Orchestrator** | Synchronous to Async | Persist durable evaluation jobs. | PostgreSQL pgmq Extension |
| **Linguistic Pre-processor** | Asynchronous | Detect target lemmas and phrases in the transcript. | Supabase Edge Function running wink-nlp |
| **Semantic Judge** | Asynchronous | Evaluate the contextual correctness of vocabulary use. | Supabase Edge Function running GPT-4o-mini |
| **State Mutator** | Asynchronous | Update spaced repetition math safely. | PostgreSQL PL/pgSQL RPC with Row-Level Locking |

## **2\. Recommended System Design**

The end-to-end design of the semantic engine requires a fault-tolerant, idempotent background processing system. Vercel Serverless Functions impose strict execution timeouts that are fundamentally incompatible with robust, multi-step LLM evaluations. The superior architectural choice is to utilize Supabase Queues, which operates on the open-source pgmq PostgreSQL extension, over hand-rolling custom job tables, providing guaranteed delivery and visibility timeouts.1

The event flow from turn completion to semantic evaluation follows a strict sequence:

1. Within the Next.js /api/sessions/\[id\]/turn route, immediately after the conversational AI response is committed, the backend initiates a PostgreSQL function call to pgmq.send(), placing a payload into the semantic\_evaluation\_queue.  
2. A Cron-triggered Supabase Edge Function worker periodically wakes up and dequeues batches of jobs using pgmq.read().1  
3. The worker processes the batch. If a worker crashes, the Visibility Timeout (VT) ensures the message becomes visible again for retries.1  
4. To avoid Edge Function runtime limits, the worker strictly enforces a time budget per invocation.

To prevent data corruption under retries, idempotency is enforced through database uniqueness constraints on UNIQUE(user\_id, session\_id, turn\_index) for semantic outputs.1

The failure and retry strategy relies on the visibility timeout mechanics inherent to pgmq. Retries are permitted up to a maximum of 3 attempts (tracked via read\_ct in pgmq).1 After exceeding this limit, messages are moved to an archive table, and a failure row is recorded in semantic\_failures to allow the engineering team to inspect the payload manually.1

## **3\. Linguistic Analysis Strategy**

The detection of target vocabulary usage within the learner's transcript cannot rely purely on standard string matching, nor should it rely exclusively on a Large Language Model. The pragmatic solution is a hybrid architecture: a deterministic natural language processing heuristic serving as a high-speed gate, followed by an LLM invocation strictly reserved for deep semantic validation.1

The background Edge Function will utilize wink-nlp, a fast, dependency-free natural language processing library. The heuristic pipeline implements the following sequence:

1. **Normalization:** Before matching, both the transcripts and the candidate words from the user's word bank must be heavily normalized. This includes applying Unicode NFKC normalization, lowercasing, and standardizing punctuation.  
2. **Matching Tiers:** Matching is performed in three tiers: phrase match, exact token match, and lemma match.1  
3. **Lemma Extraction:** The system tokenizes the transcript and extracts the true morphological root using doc.out(its.lemma) to match inflectional variants.1  
4. **Multi-Word Expressions:** The system utilizes learnCustomEntities patterns to detect compound target phrases (e.g., "cognitive dissonance").1 To avoid over-matching, the system mandates starting with strict literal patterns for these multi-word expressions.1  
5. **POS Gating:** Part-of-Speech (POS) gating is available as a soft filter using Universal POS tags to ensure syntactic categories match.1  
6. **Fuzzy Matching (Whisper Fallback):** To explicitly mitigate Whisper transcription errors, the system will implement a fuzzy matching fallback applying an allowable edit distance of ![][image1] specifically for tokens with a length of ![][image2] characters.

This deterministic gate ensures the LLM is only invoked if candidates are actually found.1

## **4\. LLM Evaluation Design**

Once the heuristic layer confirms the physical presence of a target candidate, the semantic engine transitions responsibility to the LLM. The LLM acts purely as a semantic judge. Its role is limited to discourse interpretation, such as distinguishing "used vs mentioned" or confirming semantic correctness in context.1

The payload dispatched to the model must include the exact target lemma, its formal stored definition, the specific transcript sentence, and the immediately preceding AI conversational turn.

To operationalize the output for the database, the LLM must classify the usage into one of six mutually exclusive categorical labels.

| Evaluation Label | Definition and Criteria | Spaced Repetition Impact |
| :---- | :---- | :---- |
| used\_correct | The word is used naturally, accurately, and demonstrates full comprehension.1 | Credits mastery state. |
| used\_partially\_correct | The underlying meaning is understood, but deployed with awkward syntax or poor collocation.1 | Registers as a failed retrieval. |
| used\_incorrect | The word is used in a manner that demonstrates a fundamental misunderstanding.1 | Registers as a failed retrieval. |
| mentioned\_not\_used | The learner simply stated the word without integrating it into a thought.1 | Ignored. Does not impact scoring. |
| not\_used\_false\_positive | The heuristic layer misidentified a word. | Ignored. Does not impact scoring. |
| ambiguous | The surrounding context in the transcript is too garbled to make a definitive judgment. | Ignored. Does not impact scoring. |

## **5\. Prompting Architecture**

The semantic engine will utilize a single evaluator prompt utilizing OpenAI's gpt-4o-mini with strict structured outputs (response\_format: "json\_schema").

To optimize token costs and reduce processing latency, verbose "chain-of-thought" reasoning logs are explicitly rejected.1 Instead, the schema enforces two concise auditing fields: evidence\_used (the verbatim span) and diagnostic (a 1-2 sentence explanation).1

The prompt must enforce the following JSON schema contract:

JSON

{  
  "name": "semantic\_evaluation",  
  "strict": true,  
  "schema": {  
    "type": "object",  
    "properties": {  
      "word\_analyzed": {  
        "type": "string",  
        "description": "The exact target lemma being evaluated."  
      },  
      "evidence\_used": {  
        "type": "string",  
        "description": "The verbatim span from the transcript used to make the judgment."  
      },  
      "classification\_label": {  
        "type": "string",  
        "enum": \["used\_correct", "used\_partially\_correct", "used\_incorrect", "mentioned\_not\_used", "not\_used\_false\_positive", "ambiguous"\],  
        "description": "The final pedagogical judgment."  
      },  
      "confidence": {  
        "type": "number",  
        "description": "A confidence score between 0 and 1 representing the certainty of the classification."  
      },  
      "should\_credit": {  
        "type": "boolean",  
        "description": "A boolean indicating if the usage was successful enough to warrant mastery progression."  
      },  
      "diagnostic": {  
        "type": "string",  
        "description": "A concise 1-2 sentence explanation of why the usage failed or succeeded."  
      },  
      "learner\_feedback": {  
        "type": "string",  
        "description": "A concise, single-sentence correction aimed directly at the learner. Leave empty if correct."  
      }  
    },  
    "required": \["word\_analyzed", "evidence\_used", "classification\_label", "confidence", "should\_credit", "diagnostic", "learner\_feedback"\],  
    "additionalProperties": false  
  }  
}

By forcing the model to explicitly separate the classification\_label from the deterministic should\_credit boolean and the confidence ratio, the backend logic can safely decide whether to apply spaced-repetition math even if the LLM output is borderline.

## **6\. Data Model and Supabase Design**

The database schema supporting this architecture will securely isolate data via Row Level Security (RLS) and enforce idempotency through the UNIQUE(user\_id, session\_id, turn\_index) constraint.1

The schema will introduce the evaluation\_label enum consisting of the exact categories defined in the LLM JSON schema. It will also introduce a mastery\_state enum (passive, practicing, stable, mastered, needs\_review).

The semantic\_evaluations table will serve as the immutable ledger:

| Column Name | Data Type | Constraint / Configuration | Purpose |
| :---- | :---- | :---- | :---- |
| id | UUID | Primary Key | Unique identifier. |
| session\_id | UUID | Foreign Key | Links to session (part of unique constraint). |
| turn\_index | INT | Not Null | Part of unique constraint to ensure idempotency. |
| word\_id | UUID | Foreign Key | Target word analyzed. |
| user\_id | UUID | Foreign Key | RLS filtering. |
| label | evaluation\_label | Not Null | Classification from LLM. |
| confidence\_score | NUMERIC | Check ![][image3] AND ![][image1] | Certainty of evaluation. |
| credited | BOOLEAN | Not Null | Did this attempt update the FSRS math? |
| evidence\_used | TEXT | Not Null | Verbatim span used for the judgment.1 |
| diagnostic | TEXT | Not Null | 1-2 sentence explanation.1 |
| learner\_feedback | TEXT | Nullable | Dashboard correction string. |

To eliminate race conditions, the background Edge Function will utilize a PostgreSQL Remote Procedure Call via a PL/pgSQL function named process\_evaluation\_result. This RPC immediately begins a transaction, inserts the record, executes a SELECT FOR UPDATE query on the word\_mastery table to apply a strict row-level lock, calculates the new FSRS parameters based on the should\_credit boolean, and commits the transaction.

## **7\. Mastery Logic**

The mastery logic implements a modified Free Spaced Repetition Scheduler (FSRS) tuned for active conversational retrieval. Standard FSRS is optimized for passive flashcards; active retrieval requires higher stability thresholds.

The rule set tracks Retrievability (![][image4]), Stability (![][image5]), and Difficulty (![][image6]). An "attempt" is any conversational turn where the heuristic detects the target lemma. A "successful usage" requires the LLM to return should\_credit: true (typically isolated to the used\_correct label).

Progression moves through states governed by Stability (![][image5]):

* **Passive / New:** ![][image7]. High AI sparring priority.  
* **Practicing:** ![][image8] days. Active forced retrieval.  
* **Stable:** ![][image9] days. Reduced forced retrieval pressure.  
* **Mastered:** ![][image10] days. Word transitioned to active vocabulary.  
* **Needs Review:** Misuse applies heavy penalty to ![][image5] and spikes ![][image6].

The process\_evaluation\_result RPC strictly enforces a temporal cooldown period. Multiple successes within a continuous 12-hour window only aggressively increase Stability (![][image5]) on the initial attempt, preventing learners from gaming the math by spamming a word.

## **8\. Feedback Strategy**

Feedback is categorized into internal analytics and learner-facing corrections. Internal notes (evidence\_used, diagnostic, confidence) empower engineering QA to track prompt drift and AI hallucination without incurring the cost of long Chain-of-Thought logs.1

Concise learner-facing corrections (learner\_feedback) are stored asynchronously and presented visually on the Sprint 7 Learning Funnel Dashboard. The format is strictly contrastive (e.g., *"You used X to mean Y, but it actually requires context Z."*).

**The Audio Vault Strategy:** The Audio Vault will utilize virtual audio clipping without needing FFmpeg processing on the backend.1 During the initial synchronous transcription phase in the /api/sessions/\[id\]/turn route, the Whisper-1 API call will be configured with response\_format="verbose\_json" and the specific parameter timestamp\_granularities=\["word"\].1 These word-level timestamps will be stored as JSONB in the database. When the frontend requests an audio snippet, it will use the HTML5 Web Audio API to play the specific byte-range using the pre-calculated timestamps, completely eliminating server-side media processing costs.

## **9\. Rollout Plan**

### **Phase 1: MVP Infrastructure (Sprint 6a)**

* **What to build:** Enable pgmq and create the semantic\_evaluation\_queue. Deploy the Edge Function background worker invoked by Supabase Cron using pgmq.read with a visibility timeout.1 Update Whisper transcription to capture timestamp\_granularities=\["word"\] and store as JSONB.1 Implement wink-nlp pipeline with the 3-tier matching strategy (phrase, token, lemma) and strict literal patterns for custom entities.1  
* **Success Criteria:** Jobs are reliably batched and dequeued without timeouts. Word-level timestamps are captured successfully.

### **Phase 2: The Semantic Evaluator (Sprint 6b)**

* **What to build:** Implement the gpt-4o-mini prompt architecture with the updated JSON schema including evidence\_used and diagnostic.1 Deploy the process\_evaluation\_result PL/pgSQL RPC with row-level locks and the UNIQUE(user\_id, session\_id, turn\_index) constraint.1 Implement the max 3 attempts retry logic, routing to semantic\_failures.1

### **Phase 3: Dashboard and Vault Hardening (Sprint 7\)**

* **What to build:** Frontend Next.js React components for the Learning Funnel Dashboard. Implement client-side virtual audio clipping utilizing the stored JSONB Whisper timestamps.

## **10\. Risks and Tradeoffs**

**pgmq Local Development Complexity:** While pgmq is exceptionally robust in production, it has operational rough edges in local/CLI workflows. Engineering must utilize careful version pinning in the local Docker setup to ensure parity with the hosted Supabase environment.1

**Timestamp Payload Size:** Collecting word-level timestamps via Whisper significantly increases the JSON payload size stored in the database.1 This is mitigated by storing the raw transcript array strictly as JSONB and indexing only the specific turn ID, preventing database bloat.

**Linguistic Precision vs. Recall:** Utilizing POS gating and strict phrase patterns can lead to false negatives (missed detections).1 Starting with strict literal patterns for multi-word expressions avoids the greater risk of over-matching and wasting expensive LLM tokens on false positives.

## **11\. Final Build Specification**

### **Exactly What To Build Next**

#### **1\. Implement Supabase Queues (pgmq)**

1. **Decision:** Enable pgmq and configure a Supabase Cron job to invoke the worker.  
2. **Why this is the best choice:** Dequeuing batches of jobs using pgmq.read with a visibility timeout provides guaranteed delivery without blocking the synchronous voice loop.1  
3. **Alternative rejected:** Custom job tables, rejected because pgmq provides native visibility timeouts and retry tracking (read\_ct).1  
4. **Implementation note:** Execute SELECT ext.create\_extension('pgmq');. Configure the retry limit to a maximum of 3 attempts, routing failures to a semantic\_failures table.1  
5. **Risk:** Local CLI operational rough edges require pgmq version pinning.1

#### **2\. Modify API Route to Enqueue Jobs & Capture Timestamps**

1. **Decision:** Update /api/sessions/\[id\]/turn to execute pgmq.send() atomically and modify the Whisper API call to use timestamp\_granularities=\["word"\].1  
2. **Why this is the best choice:** Gathers the exact data needed for the Audio Vault upfront without adding async processing overhead later.1  
3. **Alternative rejected:** Server-side FFmpeg processing.  
4. **Implementation note:** Change Whisper response\_format to verbose\_json and store the resulting array in a JSONB column. Wrap the pgmq.send() command in an RPC transaction.  
5. **Risk:** Increased database storage requirements for JSONB timestamps.1

#### **3\. Build the Linguistic Pre-processor (Edge Function)**

1. **Decision:** Implement wink-nlp inside the background Edge Function.  
2. **Why this is the best choice:** V8 isolates run JS NLP packages natively at blinding speeds.  
3. **Alternative rejected:** LLM-only detection.  
4. **Implementation note:** Implement the 3-tier match (phrase, token, lemma).1 Use doc.out(its.lemma) for inflection variants and apply POS gating as a soft filter.1 Use strict literal patterns in learnCustomEntities for multi-word targets.1  
5. **Risk:** Strict POS filters causing false negatives.

#### **4\. Deploy the Evaluation Database Schema**

1. **Decision:** Deploy evaluation\_label enum, semantic\_evaluations, and word\_mastery tables.  
2. **Why this is the best choice:** Enforces strict relational integrity.  
3. **Alternative rejected:** Unstructured JSON blob storage.  
4. **Implementation note:** Enforce idempotency using UNIQUE(user\_id, session\_id, turn\_index).1 Add evidence\_used and diagnostic text columns to replace verbose reasoning logs.1

#### **5\. Build the PL/pgSQL RPC Transaction**

1. **Decision:** Write process\_evaluation\_result RPC with SELECT FOR UPDATE locking.  
2. **Why this is the best choice:** Pushing FSRS math and locking logic into the database layer permanently prevents "lost updates".  
3. **Alternative rejected:** Chained asynchronous JS Supabase client calls.  
4. **Implementation note:** The RPC accepts the LLM JSON, locks the word\_mastery row, checks the should\_credit boolean, updates FSRS parameters, and commits.  
5. **Risk:** Deadlocks. Ensure the RPC executes only lightweight math without external network calls.

#### **6\. Implement the LLM Prompt Architecture**

1. **Decision:** Create a prompt utilizing gpt-4o-mini with structured JSON schema.  
2. **Why this is the best choice:** Structured schema with concise diagnostic fields saves tokens compared to open-ended Chain-of-Thought.1  
3. **Alternative rejected:** Verbose reasoning logs (rejected for cost/speed optimizations).1  
4. **Implementation note:** Enforce the schema defined in Section 5, requiring evidence\_used, diagnostic, should\_credit, and the 6 classification labels.  
5. **Risk:** Model hallucination. Mitigate by providing explicit dictionary definitions.

#### **עבודות שצוטטו**

1. deep-research-report1.md

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAUCAYAAACTQC2+AAAAqklEQVR4XmNgGAWjgAzAB8Q1QHwIiJXR5KgChIG4G4gPA7ETEDOjSlMOFIF4LgPEB+ZAzIgqTTlQB+LVUKzFQGULQIaBXL2dAeILkG9oAvyB+BMQBzFQ2QfYAM0jHR3AkvEJBohPaW4hNxDnA/E5II4DYk5UaeoDViCOYIBYCLIY5ACaAlAQgoJyBxCroMmNYACKB3EgliQCizFQkBINgHgWkbiXAWIhSQAA+DkZczhUgdMAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAXCAYAAAAcP/9qAAABk0lEQVR4Xu2VPShFYRjHHyFJMSgfRSQfWaQMyiJKGXwMDEISqxgUi2SxkEUmKVkMTDYsBosiGYjBqAxiM4rf33sv5xwn7rmXMtxf/Yb7PO89z32f93nPNUuTJjXqcAnXcRjz/GmzNjzBAcwO5JKlD3ewHstwEk+xwrtI5OIYXuC4hfy6CBTjvrmCcTJwDRc8MR/asXZ+hnOY708nRBPeYE0gPosbgdgXMrEdj3EZC/3pb6nCe7zF1lisAA+xJ77oJ9SiZjwy16pSfzoUfWcGX2Nu4h5Ox3KRyMF5vMPqQC4MdWzRPos/YIdFKOwduilLbOj08AlzrW0xt1sVf8ERz7pQVECFzi36NdPOLrE89lm7H8RnvDY39V/QFGuada97zX0pKprc1WAQOvHJ3NR/oKHR8GiI1J5kCsbZMne+QXSvdU31Unmny9w5NFiEw/8GXZkrrPTE9NxR3MYsT/xXUbd0nR7NHdsQ7uIBlnjW/Rl66XRjP9ZaSDc1sZo0nfNPFllq5++j0dxfVyKuWGJvrzT/gzfGeUCp2x69PwAAAABJRU5ErkJggg==>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAUCAYAAACTQC2+AAAAtUlEQVR4XmNgGAWjAA04AvEJII4AYlY0OaoDTiBOAuILQJwMxNyo0tQHIB+BfHYGiGuAmA9VmvqAGYidgPgwEHcDsTCqNPUBIxCbA/F+IJ4CxJKo0tQH7EBcB8RPgFgFTY4qADmR5DPQIJGADAQZfI6BRskelMpAqQ2Ur/wZIImCqgAUyaDIBkW6FQMNLAABHyDeCMR6DJBUNgqIBqAUJc4AiSdCWIyBgvgzAOJZROJeBjJKBwCkfhldiOYfXAAAAABJRU5ErkJggg==>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA8AAAAYCAYAAAAlBadpAAABCElEQVR4XmNgGAWOQPwciP8j4VdA/AuI/wLxSSAOBmJmmAZsYA4Q/wZiGyQxkIY0BoghZUDMiCQHB7xAfBiI7wKxOJqcJBA/xCEHBppA/BaI1wAxC5qcKRB/A+KrQCyCJgcGfgwQv6ajSwBBAwNErhhNHA4mMWD6lxWIkxkgLiqF8jEADxAfYICE7jEo+zoDxLbpQCwMU4gNYPMvKFQrGSCh7AoVwwpg/i1CEzcG4q8MkCjECbD5FwSiGSCGtqKJwwG++AUZCtJcjiYOBzpA/J4BM35B7FUMqJqrgdgFxLBlgKQa9PQM8j8MgNIzKMBAhsQC8Wwg5kSSJwhAXvFlgIQ4SRpHATUAAIy9PJOevTuUAAAAAElFTkSuQmCC>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAAYCAYAAAAh8HdUAAABE0lEQVR4Xu3SIUtDYRTG8TNUcCgTFJsWsQxsCrJmEpNFwYFrC4LBNBFlVUQwyAzLaxaTXcSoyWARBAd+AcPi1P+zs+G9h9tMAx/4wTjnfe/Ozp3Z0GYSa1jHVL82g9nBgWTGUMcbDrCPJ1zgAcXfo55RNHGNiURd3/CIe/MJUimhjaXYICdoxKJyig/MxQY5xGYsKi184xgjobeI6VDrpWx+Sbq4QxWF5KEYbe7M/MLgsjxb9sipaDSt9hyf5hf3UifMD2nmXGyQDXzhKDYWcGX+nmKW0cFubGiVtxiPDVLBK+ZjQ+9HT1sNdY2sJWyFeu9vcYMaXvqfteZLvGPHMn5r3vyJila+gm3zf3jWuP/5U34AsNUreE1r6AoAAAAASUVORK5CYII=>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAAXCAYAAADtNKTnAAAA+ElEQVR4Xu3SP0tCYRTH8SMUJCUugkFNDULgIpIuOgjO0bvo/ThKi1tDi2Dg0BD1GsJVRRAEdTJIKfs+99xreri3254/+MDl/u4fnvM8IvvEpYYx1ltmmPjXS3SQC174LXdYoWLun6ONOUqm20kKr3hDxnQuWfTQRdJ0m1xiigccmC5IS/QZ92xorkXXf2uLrbiPvOPKFkEaEj6PIMd4wgJF03k5wbNEz8PlDH3RXbzYrTR/mUcdX3jEkem8xC2lILq9TRyazkvc1p7iRXQeadNtkhf9i12K++ON6BzuJeIDVQzk55h/YoSh6HH/ED3qZST8d/b5X/kGTpo1fO7baeEAAAAASUVORK5CYII=>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAYAAAC8/X7cAAAB7UlEQVR4Xu2WPyhFURzHf0IRITIIKVmUjUgZFImBAUWxScpAiURMkpRBDEpSJn9iUjJJMojJYFEKKZPBYJI/3+8793r3/e698oZ3n+F+6tN7/c55r9859/x+54qEhCSMbNgIW2CuFSuAhfaE/0o6nIF3cAQOwyu4BM9gZXRqYOTAUbgOZ2FR7HCUNLgGd2CWI86dv4SnYp5MkJTBazgIM2AbvIW1zkk29fABVukBMA1XdDDBcEM34L713WYeHsNMR+xn4AmW6AEwATt0MMGUw2c4qeKd8A1Wq7hswS84BVPVWAXMV7FE0ww/xb2AdjF59qm49FoD9AOewAExRZQM7ET9FqDjkQ60ICZ5eyGUReR1rJzw6fBcPsYhO8pvMEGvRH0XYMPjw3a5CF/FTB6KmREMY+KdqGsBTJhnPMUOOGgV73MYBK5E/eKs9lWJbVU2rHRWvKtgFFw87wteMn81L/JLfxrgu/gvgN0oAtvjoZiLQtMv5uIo1QMK1k8T7I7Dusgv/SmG9+K+f3icX8TxVsD+z13Wf8hjxQLuUvGg4FOdgxcSfR/jRu3BbbFODF8NDuA4vLG+s3Uui1l9j3jXRlAw8SO4K+Y1YhOei6Mr8jrmThOurkbM420U7yOVDNhkWIvMi5/6kg0JCQlJEt/OIWSBW797xwAAAABJRU5ErkJggg==>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAYAAAC8/X7cAAACJ0lEQVR4Xu2WO0hcQRSGT9CAoij4RNDCYJDgIxAFESw0RUilRQIRtLMwCGrjgwTb4LMQFQVB0CJBCFYiNiFK0oQIQgobQVAQrFOkVPP/O/u499zZze7eG7G4H3ywzMzunXvmnDMrEhLy3yiEnfAFLI6OlcLy2IL7ykM4Bc/gCByCR3ABfoNPEkvvhGE4Ax/DKmWFY12EXLgGt2GBY5yR/wkPxZzMXbIFb5N44lgXoR1ewEY9Ad7DJT3oAwaIp50KBmsPfoTrDjfhFXwVXxnlA7yE1XoCjMNuPZgF9fAz/CT/riemySrMU+Nv4Dx8oMbjx/UO5qi5OliixtKFD2qDB3AF1rink8LnPVNjDWJePtZYXPRKIr+u4Vc4AIucizKAQXgOv4uJGGvJD0wpnh6DYYU5OS1m885i+SX2tEoGN94Df4jpaNkGQNMvJvpsNinhBtguZ+FvMS8x6FphhwHgKR7DUXF3Mr8wZRgQ6z64Yea4pyjAS3gDJ/WEhS54Dt/CfPeUb7iPP7BDT5BHcFnsR9Mi5ot9eiIJzlOYkODShy2c++B+PLA97oq3XRHm3amk3zlixOqAt7jfAmYqfhHT+xlsD+z/fDtd3UwrFrDnwsgA3ULZ2zOlTMyty0vW8322ph04JmYRP7N1LorJZ14attrIFP5GM9yHG7DWPZ2SSjH/zawvwGJjpAnztxW+FvNP1JZSQcDNz0niuenQBJ9KMMEMCQkJCYi/UMRZ8lHdULkAAAAASUVORK5CYII=>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAYAAAC8/X7cAAACQUlEQVR4Xu2WQUhUURSG/6iwKAosk6A2UYtQK1IIo0W1iBZRiwSFWulCCNSNEkm4k5IKJEOhVS2KIFpEtIuK3IiG1KJNIBgErl24LP1/jzPz3nl3pnnjWC3eBx8M996Zue/cc867QEbGhrGTnqUX6O61sT20Lrfgf2UrvU3naC+9QWfoffqJHi0s/Sv00Lv0CN3v3BdZt8oWOkFf0B2RcUV+mn6EnUwxztEp2gELRDV4SpeL+C2ybpVW+oM2+gkySB/6wQDbaSf9QrsQD0RaFKy39Bl9HPEJXaBX8yvXGKY/6QE/QQboZT9YAp2ATuIzLCV3xafLQmkyTre58XZ6j25y4/njukU3u7nDtNaNlYN+5zydhP2p0rFc9H8n3VgDfY5CY4mhiOXy6xd9D0uDSqLnUbRO0Q/0ESy6aVFKvYT9ThAd+x3Y5qPF8hXhtKqEGjoES1Wdahquw6KvZlMSHbva5QhdhD1Ed2xFeqLF3Yf0xa2UUYcL7kMbVjQSRUEu0t/0pp8oE21UG57F+tqr9rFEz/gJcYiOIXw0zbAvXvMTf0B1o+6jqF1BsimkRS1c+9B+Eqg9vkGyXQnl3Xd60E8UQcWpIlWxnsb6Ny50iu9gvV/BTqD+r6fz1a20UgEnXhhFuERf02MIp2Ol7IW9dfWSTXQvtaZXtB+2SJ/VOkfpPOylUc3NVEI97G4WfAB1h1w7U4G10DbYTTSUUv+KJnocGxxMBUDR8rfGkLpJVqM+qsoJxC9dpXyAQDpkZGSkYwVqfWIHKRUumwAAAABJRU5ErkJggg==>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADoAAAAYCAYAAACr3+4VAAADBUlEQVR4Xu2XW4hNURjHPyHklnuKB/Ki5BIlolCk3ApFUYqiPIwHtwhNIQklREnJg/JAknhk8CLk8oASoUQU8kBeXP6/8501Z+81e8/sc5pcz79+NbP2PnO+//oua41ZXXX9c+ohpolZond5rZ8YEF7429VZbBPPRINYK26L/eK6GFl59ZdpsNgujov1Ymj6cUkdxERxSBwVc0TH1BsJdRLHxBnRPbFOJm+JJvNM52m6uCmWmm9Ye2ieuCzGmFfTTvFVLEy8g8lN4poYZh7vafONyYxjkngpRsUPpK3mu9WWuomV4r5YZekNq1ZdxSXxUYwrrw0Xb8RD0b+8Nl68FVPKvyPew8vsxFqzdotXYkj8QNoo5seLrYidJLN3zFuhV/pxIWH0vPhmPi8QsREjrTWovEbcmKLEg3qKG+KkecZTOiV+iC3Wsr5HiL7RWhHxd2aYf+k+87KqRpjlMyFYMvRdnDBvtZD12Cgt1mQ+X/ok1ksiAxgFdvGKefnVko1YYVhcFUcsHVRRkU0GIsGHqguG8ozG6yVRbnvMTQbD8MCyy7kWdRE7zMuPKimigeYVwWfumg+mkGFMYCY21KrRIMqNY2Sv+GRudk3qjeqVHFLrrPYhRRt8EY3miaFP6dfYUKZRjLG7LZrWKj2xOX5QUBjCGJloj2MnDBmqbqblGMpbZxQfNm/uWIzuz2JZ/KAN0ddMW87VBdZyuBURN7JG8+9OJiEMTTafmM9avlE2hc0piWPjovkEi7VcPLHs20iW+DKGDUNnstVmMIjLAoaSJoKBZDth+L2lb22csZy1qbOfc4isMRWTopwZRIui9TzNFRfEaMtug2pFNX0Qu6xS8sT0Wjy2yoBkjUFFawRNFe/ML0ElsUPnxAbzHeBnjpSD4oVYYu0TdC3ie7lrExc3M0r4nngqxibeQ1wJn4vVYoV4ZP7Z5tiZhmHMs2sTxGLzm0hWKf8O0av8F0VcZDmvHbhYUO5Q7cWkKoVxTz+1BWdjXsB/vCgn/mMowgFLT8m66qrrP9ZPMd2UesIlfrQAAAAASUVORK5CYII=>