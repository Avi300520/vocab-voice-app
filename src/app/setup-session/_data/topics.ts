/**
 * src/app/setup-session/_data/topics.ts
 *
 * Broad, intellectually rich conversation categories.
 * Each entry represents a wide domain — the AI steers the discussion,
 * so the topic needs breadth, not a pre-scripted angle.
 */

export type TopicCategory =
  | 'HISTORY'
  | 'PHILOSOPHY'
  | 'SCIENCE'
  | 'TECHNOLOGY'
  | 'SOCIETY'
  | 'ECONOMICS'
  | 'PSYCHOLOGY'
  | 'POLITICS'
  | 'CULTURE'
  | 'ETHICS'
  | 'ENVIRONMENT'
  | 'LINGUISTICS';

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
    id: 'global-history',
    title: 'Global History & Civilisations',
    description:
      'Explore the rise and fall of empires, the forces behind revolution, and how historical patterns echo in the modern world.',
    category: 'HISTORY',
    depth: 2,
    keyTerms: ['empire', 'revolution', 'colonialism', 'legacy', 'turning point'],
    context:
      'Global history — civilisations, empires, revolutions, colonialism, and their modern legacies.',
  },
  {
    id: 'ethical-dilemmas',
    title: 'Ethical Dilemmas',
    description:
      'Wrestle with the hardest moral questions: where duty conflicts with consequence, and individual rights clash with collective good.',
    category: 'ETHICS',
    depth: 3,
    keyTerms: ['moral duty', 'consequentialism', 'justice', 'rights', 'trade-off'],
    context:
      'Ethical dilemmas — moral philosophy, duty vs. consequence, rights, justice, and hard choices.',
  },
  {
    id: 'future-technologies',
    title: 'Future Technologies',
    description:
      'Debate the societal impact of AI, biotechnology, quantum computing, and other emerging technologies reshaping civilisation.',
    category: 'TECHNOLOGY',
    depth: 3,
    keyTerms: ['AI', 'biotech', 'disruption', 'automation', 'singularity'],
    context:
      'Future technologies — AI, biotech, quantum computing, automation, and their civilisational impact.',
  },
  {
    id: 'society-inequality',
    title: 'Society & Inequality',
    description:
      'Examine class, race, gender, and power structures: how inequality is reproduced, contested, and sometimes dismantled.',
    category: 'SOCIETY',
    depth: 3,
    keyTerms: ['class', 'privilege', 'social mobility', 'systemic bias', 'solidarity'],
    context:
      'Society and inequality — class, race, gender, power structures, and paths to equity.',
  },
  {
    id: 'economics-power',
    title: 'Economics & Power',
    description:
      'Analyse markets, wealth concentration, trade, monetary policy, and the political forces that shape economic outcomes.',
    category: 'ECONOMICS',
    depth: 4,
    keyTerms: ['market', 'wealth', 'monetary policy', 'trade', 'inequality'],
    context:
      'Economics and power — markets, wealth concentration, monetary policy, trade, and political economy.',
  },
  {
    id: 'psychology-behaviour',
    title: 'Psychology & Human Behaviour',
    description:
      'Unpack cognition, bias, motivation, and social influence — why people think and act the way they do, and how to change.',
    category: 'PSYCHOLOGY',
    depth: 3,
    keyTerms: ['cognitive bias', 'motivation', 'influence', 'decision-making', 'identity'],
    context:
      'Psychology and behaviour — cognition, bias, motivation, social influence, and behaviour change.',
  },
  {
    id: 'political-theory',
    title: 'Political Theory & Governance',
    description:
      'Debate democracy, authoritarianism, sovereignty, and the fundamental question of who should wield power and why.',
    category: 'POLITICS',
    depth: 3,
    keyTerms: ['democracy', 'sovereignty', 'legitimacy', 'authoritarianism', 'consent'],
    context:
      'Political theory — democracy, authoritarianism, sovereignty, governance, and legitimate power.',
  },
  {
    id: 'philosophy-mind',
    title: 'Philosophy of Mind & Consciousness',
    description:
      'Explore what it means to be conscious, whether free will exists, and what separates the mind from the body — or the machine.',
    category: 'PHILOSOPHY',
    depth: 4,
    keyTerms: ['consciousness', 'free will', 'qualia', 'identity', 'dualism'],
    context:
      'Philosophy of mind — consciousness, free will, qualia, personal identity, and the mind-body problem.',
  },
  {
    id: 'climate-environment',
    title: 'Climate & the Environment',
    description:
      'Confront the science and politics of climate change, biodiversity loss, and the profound difficulty of coordinating a global response.',
    category: 'ENVIRONMENT',
    depth: 3,
    keyTerms: ['climate change', 'biodiversity', 'carbon', 'sustainability', 'geopolitics'],
    context:
      'Climate and environment — climate science, biodiversity, carbon policy, sustainability, and global coordination.',
  },
  {
    id: 'science-discovery',
    title: 'Science & Discovery',
    description:
      'Discuss the nature of scientific knowledge, landmark discoveries, the replication crisis, and the frontier of what we do not yet understand.',
    category: 'SCIENCE',
    depth: 3,
    keyTerms: ['hypothesis', 'paradigm shift', 'empiricism', 'replication', 'frontier'],
    context:
      'Science and discovery — scientific method, landmark discoveries, replication crisis, and knowledge frontiers.',
  },
  {
    id: 'art-culture',
    title: 'Art, Culture & Identity',
    description:
      'Examine how art and culture reflect and shape identity, nationalism, resistance, and the ever-shifting meaning of beauty.',
    category: 'CULTURE',
    depth: 2,
    keyTerms: ['identity', 'aesthetics', 'nationalism', 'resistance', 'meaning'],
    context:
      'Art, culture, and identity — aesthetics, cultural identity, nationalism, resistance, and meaning-making.',
  },
  {
    id: 'language-communication',
    title: 'Language & Communication',
    description:
      'Analyse how language constructs reality, how rhetoric shapes politics, and what the death of languages means for human diversity.',
    category: 'LINGUISTICS',
    depth: 3,
    keyTerms: ['rhetoric', 'framing', 'linguistic relativity', 'discourse', 'endangered language'],
    context:
      'Language and communication — rhetoric, framing, linguistic relativity, discourse, and endangered languages.',
  },
];

export const CATEGORY_COLORS: Record<TopicCategory, { bg: string; text: string }> = {
  HISTORY:     { bg: 'color-mix(in srgb, #D97706 15%, transparent)', text: '#D97706' },
  PHILOSOPHY:  { bg: 'color-mix(in srgb, #A78BFA 15%, transparent)', text: '#A78BFA' },
  SCIENCE:     { bg: 'color-mix(in srgb, #60A5FA 15%, transparent)', text: '#60A5FA' },
  TECHNOLOGY:  { bg: 'color-mix(in srgb, var(--color-codex-teal) 15%, transparent)', text: 'var(--color-codex-teal)' },
  SOCIETY:     { bg: 'color-mix(in srgb, #FB7185 15%, transparent)', text: '#FB7185' },
  ECONOMICS:   { bg: 'color-mix(in srgb, var(--color-codex-gold) 15%, transparent)', text: 'var(--color-codex-gold)' },
  PSYCHOLOGY:  { bg: 'color-mix(in srgb, var(--color-codex-violet) 15%, transparent)', text: 'var(--color-codex-violet)' },
  POLITICS:    { bg: 'color-mix(in srgb, #94A3B8 15%, transparent)', text: '#94A3B8' },
  CULTURE:     { bg: 'color-mix(in srgb, #F472B6 15%, transparent)', text: '#F472B6' },
  ETHICS:      { bg: 'color-mix(in srgb, #34D399 15%, transparent)', text: '#34D399' },
  ENVIRONMENT: { bg: 'color-mix(in srgb, #4ADE80 15%, transparent)', text: '#4ADE80' },
  LINGUISTICS: { bg: 'color-mix(in srgb, #2DD4BF 15%, transparent)', text: '#2DD4BF' },
};
