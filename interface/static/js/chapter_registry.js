// The 9 chapters in pipeline order. `requiresResult: false` (How HE works,
// Benchmarks) means the chapter is reachable from the flowchart before
// running any inference. `buildSteps` and `stepBands` are called once,
// right after a run completes (see chapter_state.js). `summary` is the
// one-line caption under each flowchart box -- always computed from the
// real run (or the saved benchmark results), never placeholder text.
function formatBytes(n) {
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
}

const findEvent = (result, name) => result.events.find((e) => e.operation_name === name);

function transportSummary(result, leg) {
    const w = findEvent(result, `${leg}_wrap`).data_after;
    const u = findEvent(result, `${leg}_unwrap`).data_after;
    return `AES-256-GCM · ${formatBytes(w.aes_ciphertext_size)}`
        + (u.integrity_preserved && u.tag_verified ? " · tag ✓" : " · CORRUPTED")
        + (u.tamper_test.rejected ? " · tamper rejected" : " · TAMPER ACCEPTED");
}

// Joins step lists in order; each list's last step points at the next list's first.
function joinSteps(...parts) {
    const lists = parts.filter((p) => p.steps.length);
    lists.slice(0, -1).forEach((p) => {
        const last = p.steps[p.steps.length - 1];
        last.next = p.then;
        [last.eli5, last.eli1].forEach((t) => { if (t) t.next = p.then; });
    });
    return lists.flatMap((p) => p.steps);
}

const CHAPTERS = [
    { id: "how_he", label: "How HE works", requiresResult: false,
      buildSteps: () => withVars(buildHowHeSteps(), howHeVars()),
      summary: () => `toy numbers: lock, compute, unlock · ${TOY.dec(TOY.score) / TOY.delta} ≈ ${TOY.w1 * TOY.x1.x + TOY.w2 * TOY.x2.x + TOY.b}` },
    { id: "feature", label: "Feature Extraction", requiresResult: true,
      buildSteps: (result) => {
          const steps = buildFeatureSteps(result);
          steps[steps.length - 1].facts = [{ id: "feature_x", label: "Your feature vector x, the numbers that get locked", value: `${result.feature_dim.toLocaleString()} numbers` }];
          return steps;
      },
      summary: (result) => (result.model === "sms_spam"
          ? `${result.feature_dim.toLocaleString()}-dim TF-IDF vector`
          : result.input_kind === "image" ? `${drawnImages(result).length > 1 ? `character ${(result.char_index || 0) + 1} of ${drawnImages(result).length} · ` : ""}784 pixels, scaled to 0..1`
          : result.input_kind === "symptoms" ? `${result.x.filter((v) => v === 1).length} of ${result.feature_dim} symptom flags set`
          : `${result.feature_dim.toLocaleString()} ${result.model === "human_vs_ai_text" ? "stylometric " : result.input_kind === "tabular" ? "standardized " : ""}features`) },
    { id: "key", label: "Key Setup", requiresResult: true,
      buildSteps: (result) => withVars(buildKeySteps(result), keyVars(result)),
      summary: (result) => `CKKS N=${result.ckks_params.poly_modulus_degree} · 2× RSA-${findEvent(result, "rsa_keygen_client").data_after.key_size} · PBKDF2 ${findEvent(result, "pbkdf2").data_after.iterations.toLocaleString()}×` },
    { id: "encrypt", label: "Encryption", requiresResult: true,
      buildSteps: (result, dd) => joinSteps(
          { steps: withVars(buildEncryptionSteps(result), encVars(result)), then: "Next: the same lock up close, a small CKKS (N=256) where every number is visible." },
          { steps: withVars(buildDeepDiveSteps(dd, result, "encrypt"), ddVars(dd, "encrypt")) }),
      summary: (result) => `→ ${formatBytes(findEvent(result, "ckks_encrypt").data_after.serialization.size_bytes)} ciphertext` },
    { id: "transport_out", label: "Transport → server", requiresResult: true,
      buildSteps: (result) => withVars(buildTransportSteps(result, "leg1"), transportVars(result, "leg1")),
      summary: (result) => transportSummary(result, "leg1") },
    { id: "compute", label: "Computation", requiresResult: true,
      buildSteps: (result, dd) => joinSteps(
          { steps: withVars(buildComputationSteps(result), computeVars(result)), then: "Next: the same computation up close (N=256), every number visible." },
          { steps: withVars(buildDeepDiveSteps(dd, result, "compute"), ddVars(dd, "compute")) }),
      stepBands: (result) => buildComputationBands(result),
      summary: (result) => `Enc(x)·Wᵀ + b · ${findEvent(result, "load_plaintext").data_after.nonzero_count} non-zero terms` },
    { id: "transport_back", label: "Transport ← client", requiresResult: true,
      buildSteps: (result) => withVars(buildTransportSteps(result, "leg2"), transportVars(result, "leg2")),
      summary: (result) => transportSummary(result, "leg2") },
    { id: "result", label: "Result", requiresResult: true,
      buildSteps: (result, dd) => joinSteps(
          { steps: withVars(buildDecryptionSteps(result), resultVars(result)), then: "Next: the same unlock up close (N=256), every number visible." },
          { steps: withVars(buildDeepDiveSteps(dd, result, "result"), ddVars(dd, "result")), then: "Next: what the score means." },
          { steps: withVars(buildResultSteps(result), resultVars(result)) }),
      summary: (result) => (result.input_kind === "image" && result.characters
          ? `"${readingText(result, "he_label")}" · ${result.characters.every((c) => c.match) ? "match ✓" : "MISMATCH ✕"}`
          : `${resultLabel(result.model, result.he_pred)} · ${result.match ? "match ✓" : "MISMATCH ✕"}`) },
    { id: "benchmarks", label: "Benchmarks", requiresResult: false,
      buildSteps: () => buildBenchmarksSteps(),
      summary: () => (window.BENCHMARKS ? `${window.BENCHMARKS.length} models measured` : "no results.json yet") },
];
