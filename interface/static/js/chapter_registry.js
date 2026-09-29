// The 9 real chapters in pipeline order. `requiresResult: false` (only
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

const CHAPTERS = [
    { id: "feature", label: "Feature Extraction", requiresResult: true,
      buildSteps: (result) => buildFeatureSteps(result),
      summary: (result) => result.feature_trace
          ? `${result.feature_dim} stylometric features`
          : `${result.feature_dim.toLocaleString()}-dim TF-IDF vector` },
    { id: "key", label: "Key Setup", requiresResult: true,
      buildSteps: (result) => buildKeySteps(result),
      summary: (result) => `N=${result.ckks_params.poly_modulus_degree} · scale 2^${result.ckks_params.global_scale_bits}` },
    { id: "encrypt", label: "Encryption", requiresResult: true,
      buildSteps: (result) => buildEncryptionSteps(result),
      summary: (result) => `→ ${formatBytes(findEvent(result, "ckks_encrypt").data_after.ciphertext_size)} ciphertext` },
    { id: "deepdive", label: "CKKS Deep-Dive", requiresResult: true, requiresDeepDive: true,
      buildSteps: (result, deepDive) => buildDeepDiveSteps(deepDive),
      summary: (result, deepDive) => `${deepDive.original_vector.length} values · N=${deepDive.encode.m_coeffs.length} ring` },
    { id: "compute", label: "Computation", requiresResult: true,
      buildSteps: (result) => buildComputationSteps(result),
      stepBands: (result) => buildComputationBands(result),
      summary: (result) => `${result.events.filter((e) => e.operation_name === "weight_multiply").length} multiplies + bias → 1 SIMD op` },
    { id: "transport", label: "Transport", requiresResult: true,
      buildSteps: (result) => buildTransportSteps(result),
      summary: (result) => (result.used_passphrase ? "PBKDF2+AES" : "RSA+AES")
          + (findEvent(result, "rsa_aes_unwrap").data_after.integrity_preserved ? " · intact ✓" : " · CORRUPTED") },
    { id: "decrypt", label: "Decryption", requiresResult: true,
      buildSteps: (result) => buildDecryptionSteps(result),
      summary: (result) => `score = ${result.raw_score.toFixed(4)}` },
    { id: "result", label: "Result", requiresResult: true,
      buildSteps: (result) => buildResultSteps(result),
      summary: (result) => `${resultLabel(result.model, result.he_pred)} · ${result.match ? "match ✓" : "MISMATCH ✕"}` },
    { id: "benchmarks", label: "Benchmarks", requiresResult: false,
      buildSteps: () => buildBenchmarksSteps(),
      summary: () => (window.BENCHMARKS ? `${window.BENCHMARKS.length} models measured` : "no results.json yet") },
];
