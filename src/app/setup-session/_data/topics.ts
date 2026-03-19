/**
 * src/app/setup-session/_data/topics.ts
 *
 * Curated intellectual conversation topics.
 * POLICY: mundane daily-life scenarios are EXPLICITLY EXCLUDED.
 * No ordering food. No tourist small talk. No weather chitchat.
 * Every topic demands analytical depth and rewards advanced vocabulary.
 */

export type TopicCategory =
  | "PSYCHOLOGY"
  | "CYBERSECURITY"
  | "FINANCE"
  | "PHILOSOPHY"
  | "NEUROSCIENCE"
  | "ECONOMICS"
  | "CRYPTOGRAPHY"
  | "POLITICAL THEORY";

export interface Topic {
  id: string;
  title: string;
  description: string;
  category: TopicCategory;
  /** Vocabulary depth: 1 (accessible) to 5 (highly technical) */
  depth: 1 | 2 | 3 | 4 | 5;
  keyTerms: string[];
  /** Stored in sessions.topic_context */
  context: string;
}

export const TOPICS: Topic[] = [
  {
    id: "milgram-obedience",
    title: "The Milgram Obedience Experiments",
    description: "Analyze the 1961 Milgram authority compliance research: the methodology, the ethical controversy, and what the results reveal about institutional obedience versus individual moral agency.",
    category: "PSYCHOLOGY",
    depth: 3,
    keyTerms: ["obedience", "authority", "agentic state", "moral disengagement", "replication crisis"],
    context: "Milgram obedience experiment - authority, compliance, ethics, institutional psychology",
  },
  {
    id: "rbi-data-leak",
    title: "Mitigating Data Leaks via Remote Browser Isolation",
    description: "Examine how RBI architectures intercept untrusted web content in a remote container, preventing zero-day exploits and DLP violations while maintaining enterprise latency tolerances.",
    category: "CYBERSECURITY",
    depth: 5,
    keyTerms: ["remote browser isolation", "zero-trust", "DLP", "air gap", "pixel streaming"],
    context: "Remote Browser Isolation (RBI) - zero-trust architecture, data exfiltration prevention, enterprise security",
  },
  {
    id: "emh-behavioral-finance",
    title: "Efficient Market Hypothesis vs. Behavioral Finance",
    description: "Interrogate the EMH against behavioral economics evidence: can markets be rational in aggregate yet systematically exploitable through cognitive bias arbitrage?",
    category: "FINANCE",
    depth: 4,
    keyTerms: ["efficient market", "anomaly", "arbitrage", "cognitive bias", "alpha", "mean reversion"],
    context: "EMH vs. behavioral finance - market efficiency, cognitive biases, asset pricing anomalies",
  },
  {
    id: "stanford-prison",
    title: "The Stanford Prison Experiment and Situational Forces",
    description: "Critically evaluate the 1971 Stanford simulation: how situational variables override dispositional character, and why recent scholarly re-examinations challenge the original interpretation.",
    category: "PSYCHOLOGY",
    depth: 3,
    keyTerms: ["situationism", "deindividuation", "role absorption", "demand characteristics", "replication"],
    context: "Stanford Prison Experiment - situational psychology, role theory, ethics of social research",
  },
  {
    id: "prospect-theory",
    title: "Prospect Theory and Loss Aversion",
    description: "Unpack the 1979 Kahneman-Tversky framework: how the S-shaped value function, probability weighting, and reference-point dependence systematically violate expected utility theory.",
    category: "ECONOMICS",
    depth: 4,
    keyTerms: ["loss aversion", "reference point", "probability weighting", "framing effect", "endowment effect"],
    context: "Prospect theory - loss aversion, decision-making under risk, deviations from rationality",
  },
  {
    id: "zero-knowledge-proofs",
    title: "Zero-Knowledge Proofs in Modern Cryptography",
    description: "Explore zk-SNARKs and zk-STARKs: how a prover convinces a verifier of a truth without revealing any underlying information, and their role in privacy-preserving blockchains.",
    category: "CRYPTOGRAPHY",
    depth: 5,
    keyTerms: ["zero-knowledge", "zk-SNARK", "prover", "verifier", "completeness", "soundness", "succinct proof"],
    context: "Zero-knowledge proofs - cryptographic privacy, zk-SNARKs, blockchain verification",
  },
  {
    id: "dunning-kruger",
    title: "The Dunning-Kruger Effect and Metacognitive Failure",
    description: "Scrutinize the 1999 study and its mathematical re-analyses: does the effect reflect genuine metacognitive blindness, or is it a statistical artefact of regression to the mean?",
    category: "PSYCHOLOGY",
    depth: 3,
    keyTerms: ["metacognition", "calibration", "illusory superiority", "regression artifact", "epistemic humility"],
    context: "Dunning-Kruger effect - metacognition, self-assessment, epistemic overconfidence",
  },
  {
    id: "supply-chain-attacks",
    title: "Supply Chain Attack Vectors and Organizational Resilience",
    description: "Dissect SolarWinds-style infiltration: how adversaries compromise trusted build pipelines, the detection gap problem, and the tension between software provenance and development velocity.",
    category: "CYBERSECURITY",
    depth: 5,
    keyTerms: ["supply chain attack", "SBOM", "build pipeline", "lateral movement", "SLSA framework"],
    context: "Software supply chain attacks - SolarWinds, SBOM, build pipeline security, vendor trust",
  },
  {
    id: "black-scholes",
    title: "Black-Scholes Options Pricing and Its Limits",
    description: "Derive the intuition behind Black-Scholes, examine its assumptions (log-normal returns, constant volatility), and explore why volatility smiles and tail events expose structural fragility.",
    category: "FINANCE",
    depth: 5,
    keyTerms: ["implied volatility", "volatility smile", "delta hedging", "fat tails", "lognormal", "Greeks"],
    context: "Black-Scholes model - options pricing, implied volatility, market assumptions and failures",
  },
  {
    id: "bystander-effect",
    title: "The Bystander Effect and Diffusion of Responsibility",
    description: "Examine the Kitty Genovese case research by Darley and Latane: pluralistic ignorance, diffusion of responsibility, and the field experiments that have since complicated the picture.",
    category: "PSYCHOLOGY",
    depth: 2,
    keyTerms: ["bystander effect", "diffusion of responsibility", "pluralistic ignorance", "prosocial behavior"],
    context: "Bystander effect - social inhibition of helping behavior, diffusion of responsibility",
  },
  {
    id: "cognitive-dissonance",
    title: "Cognitive Dissonance and Belief Rationalization",
    description: "Trace Festinger from 1957 through modern neuroscience: how the brain resolves conflicting beliefs via motivated reasoning, and the implications for persuasion and behavior change.",
    category: "PSYCHOLOGY",
    depth: 3,
    keyTerms: ["cognitive dissonance", "motivated reasoning", "rationalization", "belief perseverance"],
    context: "Cognitive dissonance - psychological tension, belief rationalization, motivated reasoning",
  },
  {
    id: "game-theory-nash",
    title: "Nash Equilibria, Cooperation, and the Prisoner Dilemma",
    description: "Navigate game-theoretic models of strategic interaction: when rational self-interest produces collectively suboptimal outcomes, and what mechanisms enable cooperation to emerge.",
    category: "ECONOMICS",
    depth: 4,
    keyTerms: ["Nash equilibrium", "dominant strategy", "Pareto optimality", "repeated game", "tit-for-tat"],
    context: "Game theory - Nash equilibrium, prisoner dilemma, cooperation and defection dynamics",
  },
];

export const CATEGORY_COLORS: Record<TopicCategory, { bg: string; text: string }> = {
  "PSYCHOLOGY":       { bg: "color-mix(in srgb, var(--color-codex-violet) 15%, transparent)",       text: "var(--color-codex-violet)" },
  "CYBERSECURITY":    { bg: "color-mix(in srgb, var(--color-codex-teal) 15%, transparent)",         text: "var(--color-codex-teal)" },
  "FINANCE":          { bg: "color-mix(in srgb, var(--color-codex-gold) 15%, transparent)",         text: "var(--color-codex-gold)" },
  "PHILOSOPHY":       { bg: "color-mix(in srgb, #A78BFA 15%, transparent)",                        text: "#A78BFA" },
  "NEUROSCIENCE":     { bg: "color-mix(in srgb, #FB7185 15%, transparent)",                        text: "#FB7185" },
  "ECONOMICS":        { bg: "color-mix(in srgb, var(--color-codex-gold-bright) 15%, transparent)", text: "var(--color-codex-gold-bright)" },
  "CRYPTOGRAPHY":     { bg: "color-mix(in srgb, var(--color-status-new) 15%, transparent)",        text: "var(--color-status-new)" },
  "POLITICAL THEORY": { bg: "color-mix(in srgb, #94A3B8 15%, transparent)",                       text: "#94A3B8" },
};
