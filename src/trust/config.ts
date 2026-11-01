// Every trust threshold lives here, so the rules can be tuned with the simulator and explained in one place.
// Letters match the trust-rules table in README.md.
export const TRUST = {
  /** Only the most recent reports per identifier are compared, so a flood cannot slow ingestion. */
  maxReportsAssessed: 200,

  // B. Same network
  sameNetworkWindowMs: 24 * 3_600_000, // same ip_prefix on the same identifier within 24 h = one person
  sybilRingMinReporters: 3, // 3+ different reporter_ids behind one ip_prefix within that window = sybil ring
  sybilRingWeight: 0.5, // a ring still counts as one (low-trust) person, never as many
  multiAccountVoiceMin: 5, // a "person" made of 5+ accounts (e.g. a copy-paste group) never feeds map or alerts

  // B2. Prefix cycling (one host rotating fake ip_prefix values). Same /16 block, each report within 5 minutes of
  // the previous one, 3+ different /24 prefixes and 3+ accounts = one network cluster, counted as one person.
  // Two real neighbours on one carrier block, or reports more than 5 minutes apart, are never merged by this rule.
  subnetClustering: process.env.SUBNET_CLUSTERING !== "false",
  subnetWindowMs: Math.max(1, Number(process.env.SUBNET_WINDOW_MINUTES ?? 5) || 5) * 60_000,
  subnetMinPrefixes: 3,
  subnetMinReporters: 3,

  // C. Copy-paste notes (character 5-gram Jaccard on the normalised note). Similar or identical notes from different
  // accounts merge only with a sign of coordination: filed within copyPasteWindowMs of each other, or shared by
  // copyPasteGroupMin+ accounts. Real victims who happen to use the same stock sentence days apart stay separate.
  nearDuplicateJaccard: 0.6,
  copyPasteWindowMs: 6 * 3_600_000,
  copyPasteGroupMin: 5,
  shortNoteExactMatchBelow: 15, // shorter notes only match when identical

  // D. Coordinated burst
  burstWindowMs: 3 * 3_600_000,
  burstMinReporters: 6,
  // Text diversity = distinct texts in the burst / people in the burst (empty notes add no text). 40 friends share
  // 1-3 texts (or none); 15 unrelated victims write many different ones.
  burstMinTextDiversity: 0.3,
  burstMinNetworkShare: 0.3, // below this share of distinct networks the burst is treated as coordinated
  ownWordsMinChars: 15, // a note at least this long counts as describing what happened

  // E. Weights
  weightNewReporter: 0.8,
  weightReturningReporter: 0.9,
  weightPerCorroboration: 0.25, // on top of 1.0, for each other identifier this person helped confirm
  weightMax: 1.5,
  weightFlaggedReporter: 0.5, // took part in a burst or sybil ring elsewhere
  factorEmptyNote: 0.85,
  factorEvidence: 1.1, // screenshot attached or money lost

  // Personal-number protection
  factorPersonalDispute: 0.5, // note describes a grudge ("my ex", "owes me money"), not a scam pattern
  serialAccuserMinLonely: 3, // reported 3+ other numbers that nobody else ever confirmed...
  weightSerialAccuser: 0.6, // ...so this reporter's word counts for less

  // Verdict ladder
  suspiciousMinVoices: 2, // ONE person can never make a number look suspicious to the public
  knownScamMinVoices: 3, // the same "3 different people" bar the brief uses for unmasking
  knownScamMinWeight: 2.0,
  // Large campaigns only: once this many people report, at least substanceMinShare of them must have described
  // what happened (own words) or attached proof. Small real cases often have empty notes, so they are exempt.
  substanceAppliesFromVoices: 8,
  substanceMinShare: 0.2,

  // H. Rate limits (by reporter_id, using report timestamps)
  rateWindowMs: 3_600_000,
  rateMaxSameIdentifier: 3,
  rateMaxPerReporter: 30,
  spamRepeatMin: 3, // 3+ reports on one identifier by one person within spamRepeatWindowMs: one person, never feeds alerts
  spamRepeatWindowMs: 24 * 3_600_000,
} as const;

export type TrustConfig = typeof TRUST;
