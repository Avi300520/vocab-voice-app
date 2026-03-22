/**
 * supabase/functions/semantic-worker/index.ts
 *
 * Sprint 6a/6b — Linguistic Pre-processor + Semantic Evaluator Edge Function
 *
 * This Deno Edge Function is invoked every 30 seconds by a pg_cron job.
 * It dequeues batches of semantic evaluation jobs from the pgmq queue,
 * fetches the user's word bank, runs a deterministic wink-nlp pipeline
 * to detect candidate vocabulary usage, then evaluates each candidate
 * via GPT-4o-mini structured output and persists results via the
 * process_evaluation_result RPC.
 *
 * NLP pipeline (Sprint 6a):
 *   Tier 1 — Phrase match (multi-word custom entities)
 *   Tier 2 — Exact token match
 *   Tier 3 — Lemma match (morphological root via wink-nlp)
 *   Tier 4 — Fuzzy match (Levenshtein ≤1 for tokens ≥5 chars, Whisper fallback)
 *
 * Semantic evaluator (Sprint 6b):
 *   GPT-4o-mini with strict JSON schema → process_evaluation_result RPC
 *   6 classification labels, evidence_used, diagnostic, should_credit
 */

// @ts-nocheck — Deno npm: specifiers are not recognized by tsc
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import OpenAI from "npm:openai@4.73.0";
import winkNLP from "npm:wink-nlp@2.3.0";
import model from "npm:wink-eng-lite-web-model@1.8.1";
import its from "npm:wink-nlp@2.3.0/src/its.js";
import as from "npm:wink-nlp@2.3.0/src/as.js";

// ── Constants ────────────────────────────────────────────────────────────────
const TIME_BUDGET_MS     = 25_000;  // 25s — conservative under 150s Edge Function max
const BATCH_SIZE         = 5;
const VISIBILITY_TIMEOUT = 60;      // seconds — crashed jobs reappear after this
const MAX_READ_CT        = 3;       // max retry attempts before dead-letter
const QUEUE_NAME         = 'semantic_evaluation_queue';

// ── NLP singleton (initialized once per cold start) ─────────────────────────
const nlp = winkNLP(model);

// ── OpenAI singleton (initialized once per cold start) ──────────────────────
const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY')! });

// ── Types ───────────────────────────────────────────────────────────────────

interface QueueMessage {
  msg_id:      number;
  read_ct:     number;
  enqueued_at: string;
  vt:          string;
  message: {
    session_id:  string;
    user_id:     string;
    turn_index:  number;
    transcript:  string;
    enqueued_at: string;
  };
}

interface WordBankEntry {
  id:         string;
  word:       string;
  definition: string | null;
  tags:       string[];
}

interface MatchCandidate {
  word_id:           string;
  target_word:       string;
  target_definition: string | null;
  matched_span:      string;
  match_tier:        'phrase' | 'token' | 'lemma' | 'fuzzy';
  pos_tag:           string | null;
  pos_mismatch:      boolean;
  sentence_context:  string;
}

interface LLMEvaluation {
  word_analyzed:        string;
  evidence_used:        string;
  classification_label: 'used_correct' | 'used_partially_correct' | 'used_incorrect' |
                        'mentioned_not_used' | 'not_used_false_positive' | 'ambiguous';
  confidence:           number;
  should_credit:        boolean;
  diagnostic:           string;
  learner_feedback:     string;
}

// ── Semantic Evaluation JSON Schema (Section 5 of spec) ─────────────────────
// Enforced via OpenAI structured output (response_format: json_schema).
// All 7 fields are required; additionalProperties is false.

const EVALUATION_JSON_SCHEMA = {
  name: 'semantic_evaluation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      word_analyzed: {
        type: 'string',
        description: 'The exact target lemma being evaluated.',
      },
      evidence_used: {
        type: 'string',
        description: 'The verbatim span from the transcript used to make the judgment.',
      },
      classification_label: {
        type: 'string',
        enum: [
          'used_correct',
          'used_partially_correct',
          'used_incorrect',
          'mentioned_not_used',
          'not_used_false_positive',
          'ambiguous',
        ],
        description: 'The final pedagogical judgment.',
      },
      confidence: {
        type: 'number',
        description: 'A confidence score between 0 and 1 representing the certainty of the classification.',
      },
      should_credit: {
        type: 'boolean',
        description: 'A boolean indicating if the usage was successful enough to warrant mastery progression.',
      },
      diagnostic: {
        type: 'string',
        description: 'A concise 1-2 sentence explanation of why the usage failed or succeeded.',
      },
      learner_feedback: {
        type: 'string',
        description: 'A concise, single-sentence correction aimed directly at the learner. Empty string if correct.',
      },
    },
    required: [
      'word_analyzed',
      'evidence_used',
      'classification_label',
      'confidence',
      'should_credit',
      'diagnostic',
      'learner_feedback',
    ],
    additionalProperties: false,
  },
} as const;

// ── Text Normalization ──────────────────────────────────────────────────────
// Applied to both transcripts and word bank entries before any matching.
// Spec requires: Unicode NFKC, lowercasing, punctuation standardization.

function normalize(text: string): string {
  return text
    .normalize('NFKC')                    // Unicode NFKC normalization
    .toLowerCase()                         // Case folding
    .replace(/[\u2018\u2019]/g, "'")      // Smart quotes → ASCII
    .replace(/[\u201C\u201D]/g, '"')      // Smart double quotes → ASCII
    .replace(/[\u2014\u2013]/g, '-')      // Em/en dash → hyphen
    .replace(/[^\w\s'-]/g, ' ')           // Strip non-word chars except apostrophe/hyphen
    .replace(/\s+/g, ' ')                 // Collapse whitespace
    .trim();
}

// ── Levenshtein Distance ────────────────────────────────────────────────────
// Used for Tier 4 fuzzy matching to mitigate Whisper transcription errors.
// Edit distance ≤ 1 for tokens with length ≥ 5 characters only.

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(token: string, target: string): boolean {
  if (target.length < 5) return false;  // Only for tokens ≥ 5 chars
  return levenshteinDistance(token, target) <= 1;
}

// ── Multi-Word Entity Registration ──────────────────────────────────────────
// Uses learnCustomEntities with strict literal patterns per spec.
// No wildcards, no POS patterns — just the exact normalized token sequence.

function registerMultiWordEntities(
  nlpInstance: ReturnType<typeof winkNLP>,
  phrases: string[],
): void {
  const patterns = phrases.map((phrase) => ({
    name: normalize(phrase),
    patterns: [normalize(phrase).split(/\s+/)],
  }));
  if (patterns.length > 0) {
    nlpInstance.learnCustomEntities(patterns);
  }
}

// ── 3-Tier Matching Pipeline ────────────────────────────────────────────────
// Spec Section 3: phrase match → exact token → lemma → fuzzy (Whisper fallback)
// Deduplication: once a word_id is matched at a higher tier, lower tiers skip it.

function detectCandidates(
  transcript: string,
  wordBank: WordBankEntry[],
  nlpInstance: ReturnType<typeof winkNLP>,
): MatchCandidate[] {
  const normalizedTranscript = normalize(transcript);
  const doc = nlpInstance.readDoc(normalizedTranscript);

  const tokens    = doc.tokens().out();
  const lemmas    = doc.tokens().out(its.lemma);
  const posTags   = doc.tokens().out(its.pos);
  const sentences = doc.sentences().out();

  // Partition word bank into single-word and multi-word targets
  const singleWords: WordBankEntry[] = [];
  const multiWords:  WordBankEntry[] = [];
  for (const entry of wordBank) {
    if (entry.word.trim().includes(' ')) {
      multiWords.push(entry);
    } else {
      singleWords.push(entry);
    }
  }

  // Register multi-word targets as custom entities
  if (multiWords.length > 0) {
    registerMultiWordEntities(nlpInstance, multiWords.map((w) => w.word));
  }

  // Re-process doc after learning custom entities (required by wink-nlp)
  const docWithEntities = nlpInstance.readDoc(normalizedTranscript);
  const customEntities  = docWithEntities.customEntities().out(its.detail);

  const candidates: MatchCandidate[] = [];
  const matchedWordIds = new Set<string>();

  // Helper: find the sentence containing a span
  const findSentence = (span: string): string => {
    return sentences.find((s: string) =>
      normalize(s).includes(span)
    ) ?? normalizedTranscript;
  };

  // ── Tier 1: Phrase match (multi-word expressions) ───────────────────────
  for (const entity of customEntities) {
    const matchedEntry = multiWords.find(
      (w) => normalize(w.word) === entity.type,
    );
    if (matchedEntry && !matchedWordIds.has(matchedEntry.id)) {
      matchedWordIds.add(matchedEntry.id);
      candidates.push({
        word_id:           matchedEntry.id,
        target_word:       matchedEntry.word,
        target_definition: matchedEntry.definition,
        matched_span:      entity.value,
        match_tier:        'phrase',
        pos_tag:           null,
        pos_mismatch:      false,
        sentence_context:  findSentence(entity.value),
      });
    }
  }

  // ── Tier 2: Exact token match ───────────────────────────────────────────
  for (const entry of singleWords) {
    if (matchedWordIds.has(entry.id)) continue;
    const normalizedWord = normalize(entry.word);
    const tokenIdx = tokens.findIndex((t: string) => t === normalizedWord);
    if (tokenIdx !== -1) {
      matchedWordIds.add(entry.id);
      candidates.push({
        word_id:           entry.id,
        target_word:       entry.word,
        target_definition: entry.definition,
        matched_span:      tokens[tokenIdx],
        match_tier:        'token',
        pos_tag:           posTags[tokenIdx],
        pos_mismatch:      false,
        sentence_context:  findSentence(tokens[tokenIdx]),
      });
    }
  }

  // ── Tier 3: Lemma match ─────────────────────────────────────────────────
  for (const entry of singleWords) {
    if (matchedWordIds.has(entry.id)) continue;
    const targetDoc   = nlpInstance.readDoc(normalize(entry.word));
    const targetLemma = targetDoc.tokens().out(its.lemma)[0];
    if (!targetLemma) continue;

    const lemmaIdx = lemmas.findIndex((l: string) => l === targetLemma);
    if (lemmaIdx !== -1) {
      matchedWordIds.add(entry.id);
      candidates.push({
        word_id:           entry.id,
        target_word:       entry.word,
        target_definition: entry.definition,
        matched_span:      tokens[lemmaIdx],
        match_tier:        'lemma',
        pos_tag:           posTags[lemmaIdx],
        pos_mismatch:      false,
        sentence_context:  findSentence(tokens[lemmaIdx]),
      });
    }
  }

  // ── Tier 4: Fuzzy match (Whisper fallback, ≥5 chars, edit distance ≤1) ─
  for (const entry of singleWords) {
    if (matchedWordIds.has(entry.id)) continue;
    const normalizedWord = normalize(entry.word);
    if (normalizedWord.length < 5) continue;

    const tokenIdx = tokens.findIndex((t: string) => fuzzyMatch(t, normalizedWord));
    if (tokenIdx !== -1) {
      matchedWordIds.add(entry.id);
      candidates.push({
        word_id:           entry.id,
        target_word:       entry.word,
        target_definition: entry.definition,
        matched_span:      tokens[tokenIdx],
        match_tier:        'fuzzy',
        pos_tag:           posTags[tokenIdx],
        pos_mismatch:      false,
        sentence_context:  findSentence(tokens[tokenIdx]),
      });
    }
  }

  // ── POS Gating (soft filter) ────────────────────────────────────────────
  // Flag candidates where the transcript token's POS doesn't align with
  // the expected POS of the target word. This is a SOFT filter per spec —
  // mismatches are flagged for the LLM evaluator, not discarded.
  for (const candidate of candidates) {
    if (candidate.pos_tag && candidate.match_tier !== 'phrase') {
      const targetDoc = nlpInstance.readDoc(normalize(candidate.target_word));
      const targetPOS = targetDoc.tokens().out(its.pos)[0];
      if (targetPOS && candidate.pos_tag !== targetPOS) {
        candidate.pos_mismatch = true;
      }
    }
  }

  return candidates;
}

// ── LLM Semantic Evaluator ───────────────────────────────────────────────────
// Calls GPT-4o-mini with the Section 5 structured JSON schema to classify
// each match candidate. Temperature 0.1 for classification consistency.

async function evaluateCandidate(
  candidate: MatchCandidate,
  transcript: string,
  precedingAiTurn: string | null,
): Promise<LLMEvaluation> {
  const systemPrompt = `You are a strict semantic judge for a vocabulary learning application.

Your task: determine whether a language learner genuinely USED a target word in their speech, or merely mentioned/repeated it without demonstrating understanding.

Classification rules:
- "used_correct": The learner used the word naturally and correctly in context, demonstrating understanding of its meaning. Inflected forms (e.g., "analyzing" for "analyze") count as correct usage.
- "used_partially_correct": The learner used the word with minor semantic or grammatical errors, but showed partial understanding.
- "used_incorrect": The learner used the word but the meaning is clearly wrong for the context.
- "mentioned_not_used": The learner simply stated the word, repeated it from the AI's turn, or asked about it (e.g., "what does X mean?", "you said X") without using it in their own original sentence.
- "not_used_false_positive": The NLP pipeline incorrectly matched this word — the transcript does not actually contain the target word or a valid inflection.
- "ambiguous": Cannot determine with reasonable confidence whether the usage is genuine due to garbled audio or unclear context.

Credit rules:
- should_credit = true ONLY for "used_correct"
- should_credit = false for ALL other labels

Be strict: parroting the AI's exact phrasing from the preceding turn is "mentioned_not_used", not "used_correct".
Keep diagnostic to 1-2 sentences. No chain-of-thought reasoning.
If the usage is correct, learner_feedback should be an empty string.`;

  const userPrompt = `Target word: "${candidate.target_word}"
Stored definition: ${candidate.target_definition ? `"${candidate.target_definition}"` : 'not available'}
Match tier: ${candidate.match_tier}
Matched span in transcript: "${candidate.matched_span}"
POS mismatch flagged: ${candidate.pos_mismatch}

Learner's full transcript:
"${transcript}"

Sentence containing the match:
"${candidate.sentence_context}"

${precedingAiTurn ? `Preceding AI turn:\n"${precedingAiTurn}"` : 'No preceding AI turn available.'}

Classify this usage.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: EVALUATION_JSON_SCHEMA,
    },
    temperature: 0.1,
    max_tokens: 300,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from LLM evaluation');
  }

  return JSON.parse(content) as LLMEvaluation;
}

// ── Fetch Preceding AI Turn ─────────────────────────────────────────────────
// Needed for parrot detection: if the learner simply repeated what the AI said,
// the evaluation should be "mentioned_not_used", not "used_correct".

async function fetchPrecedingAiTurn(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  turnIndex: number,
): Promise<string | null> {
  if (turnIndex <= 1) return null;

  const { data } = await supabase
    .from('session_messages')
    .select('content')
    .eq('session_id', sessionId)
    .eq('turn_index', turnIndex - 1)
    .eq('role', 'assistant')
    .single();

  return data?.content ?? null;
}

// ── Job Processor ───────────────────────────────────────────────────────────

async function processJob(
  supabase: ReturnType<typeof createClient>,
  msg: QueueMessage,
  nlpInstance: ReturnType<typeof winkNLP>,
): Promise<void> {
  const { session_id, user_id, turn_index, transcript } = msg.message;

  // 1. Fetch user's word bank
  const { data: wordBank, error: wbError } = await supabase
    .from('words')
    .select('id, word, definition, tags')
    .eq('user_id', user_id);

  if (wbError || !wordBank || wordBank.length === 0) {
    console.warn(`[semantic-worker] No word bank for user ${user_id}, skipping.`);
    return;
  }

  // 2. Run NLP detection pipeline
  const candidates = detectCandidates(transcript, wordBank, nlpInstance);

  console.log(
    `[semantic-worker] session=${session_id} turn=${turn_index} ` +
    `candidates=${candidates.length}/${wordBank.length}`,
  );

  if (candidates.length === 0) {
    // No vocabulary detected — nothing for the LLM to evaluate.
    // Job is complete.
    return;
  }

  // 3. Fetch preceding AI turn (once per job, for parrot detection)
  const precedingAiTurn = await fetchPrecedingAiTurn(supabase, session_id, turn_index);

  // 4. Evaluate each candidate via LLM + persist via RPC
  for (const candidate of candidates) {
    try {
      const evaluation = await evaluateCandidate(candidate, transcript, precedingAiTurn);

      console.log(
        `  [${candidate.match_tier}] "${candidate.target_word}" → ` +
        `${evaluation.classification_label} (confidence: ${evaluation.confidence}, ` +
        `credit: ${evaluation.should_credit})`,
      );

      // 5. Persist evaluation and update mastery via process_evaluation_result RPC
      const { error: rpcError } = await supabase.rpc('process_evaluation_result', {
        p_session_id:       session_id,
        p_user_id:          user_id,
        p_turn_index:       turn_index,
        p_word_id:          candidate.word_id,
        p_label:            evaluation.classification_label,
        p_confidence:       evaluation.confidence,
        p_should_credit:    evaluation.should_credit,
        p_evidence:         evaluation.evidence_used,
        p_diagnostic:       evaluation.diagnostic,
        p_learner_feedback: evaluation.learner_feedback || null,
      });

      if (rpcError) {
        console.error(
          `[semantic-worker] RPC error for word ${candidate.word_id}:`,
          rpcError.message,
        );
      }
    } catch (evalErr) {
      // Log but don't fail the entire job for a single candidate's LLM error.
      // Other candidates in this turn can still be evaluated.
      console.error(
        `[semantic-worker] LLM eval failed for "${candidate.target_word}":`,
        evalErr instanceof Error ? evalErr.message : String(evalErr),
      );
    }
  }
}

// ── Main Handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  const invocationStart = Date.now();

  // ── Internal secret guard (replaces JWT, since verify_jwt = false) ────────
  // The pg_cron job sends X-Internal-Secret from Vault. Anything without the
  // correct secret is rejected immediately — before any DB or NLP work.
  const expectedSecret = Deno.env.get('CRON_INVOKE_SECRET');
  const providedSecret = req.headers.get('X-Internal-Secret');
  if (!expectedSecret || providedSecret !== expectedSecret) {
    console.warn('[semantic-worker] Unauthorized: missing or invalid X-Internal-Secret');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase       = createClient(supabaseUrl, serviceRoleKey);

  // ── Dequeue batch ─────────────────────────────────────────────────────
  const { data: messages, error: readError } = await supabase.rpc('pgmq_read', {
    p_queue_name: QUEUE_NAME,
    p_vt:         VISIBILITY_TIMEOUT,
    p_batch_size: BATCH_SIZE,
  });

  if (readError) {
    console.error('[semantic-worker] pgmq_read failed:', readError.message);
    return new Response(
      JSON.stringify({ error: readError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!messages || messages.length === 0) {
    return new Response(
      JSON.stringify({ processed: 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let processed = 0;

  for (const msg of messages as QueueMessage[]) {
    // ── Time budget check ─────────────────────────────────────────────
    if (Date.now() - invocationStart > TIME_BUDGET_MS) {
      console.warn('[semantic-worker] Time budget exhausted, stopping batch.');
      break;  // Remaining messages stay in queue — VT will make them visible again
    }

    // ── Dead-letter check ─────────────────────────────────────────────
    if (msg.read_ct > MAX_READ_CT) {
      await supabase.from('semantic_failures').insert({
        msg_id:    msg.msg_id,
        payload:   msg.message,
        read_ct:   msg.read_ct,
        error_msg: 'Exceeded maximum retry attempts',
      });
      await supabase.rpc('pgmq_archive', {
        p_queue_name: QUEUE_NAME,
        p_msg_id:     msg.msg_id,
      });
      console.warn(`[semantic-worker] Job ${msg.msg_id} dead-lettered after ${msg.read_ct} attempts.`);
      continue;
    }

    // ── Process job ───────────────────────────────────────────────────
    try {
      await processJob(supabase, msg, nlp);

      // Delete successfully processed job from queue
      await supabase.rpc('pgmq_delete', {
        p_queue_name: QUEUE_NAME,
        p_msg_id:     msg.msg_id,
      });
      processed++;
    } catch (err) {
      console.error(
        `[semantic-worker] Job ${msg.msg_id} failed:`,
        err instanceof Error ? err.message : String(err),
      );
      // Do NOT delete — VT expiry will make it visible for retry
    }
  }

  return new Response(
    JSON.stringify({ processed, total: messages.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
