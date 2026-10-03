// Each chapter's variables and this run's values for them (var_label.js): in a step's text, every one of
// these symbols shows its value with the symbol underneath, except where it is being assigned ("q₀ = …").
// chapter_registry.js applies them with withVars; a step's own `vars` (e.g. the server's RSA numbers in its
// step) win. Whole polynomials (pk₀, u, m(X), c₀ …) are not listed: one number can't stand for 8192.
const evData = (result, name) => findEvent(result, name).data_after;

function howHeVars() {
    const T = TOY;
    return {
        q: T.q, "Δ": T.delta, s: T.s, e: T.e, pk0: T.pk0, pk1: T.pk1, "pk₀": T.pk0, "pk₁": T.pk1,
        "x₁": T.x1.x, "x₂": T.x2.x, "m₁": T.x1.m, "m₂": T.x2.m, "w₁": T.w1, "w₂": T.w2, b: T.b,
    };
}

function keyVars(result) {
    const p = result.ckks_params, d = evData(result, "pbkdf2");
    return {
        N: p.poly_modulus_degree, "Δ": `2^${p.global_scale_bits}`,
        P: `"${d.passphrase}"`, K: d.hmac_key.K_hex, "U₁": d.u1.outer_digest_hex, T: d.derived_key_hex,
    };
}

function encVars(result) {
    const e = evData(result, "ckks_encrypt"), primes = e.rns.data_primes;
    return {
        N: e.params.N, "Δ": `2^${e.params.scale_bits}`, d: result.x.length,
        "q₀": primes[0], "q₁": primes[1], "q₂": primes[2], q: String(primes.reduce((a, v) => a * BigInt(v), 1n)),
        "m₀": e.canonical_embedding.coeffs_all[0],
    };
}

function transportVars(result, leg) {
    const w = evData(result, `${leg}_wrap`), t = w.aes_trace;
    const rsa = evData(result, leg === "leg1" ? "rsa_keygen_server" : "rsa_keygen_client");
    return { n: rsa.n, e: rsa.e, d: rsa.d, k: w.aes_key_hex, H: t.h_hex, "J₀": t.j0_hex, c: w.encrypted_aes_key_b64 };
}

function computeVars(result) {
    const bias = result.events.find((e) => e.operation_name === "add_bias").data_after;
    return { "Δ": `2^${result.ckks_params.global_scale_bits}`, ...(result.task === "binary" ? { b: fmt(bias.bias, 6) } : {}) };
}

function resultVars(result) {
    return result.task === "binary" ? { p: fmt(result.sigmoid_score, 6) } : {};
}

// stage: in the encrypt/result parts b is the public-key polynomial (not a number); only the compute part's
// b is the model's bias.
function ddVars(dd, stage) {
    if (!dd) return {};
    return { N: dd.params.N, q: dd.params.Q, "Δ": dd.params.scale, ...(stage === "compute" ? { b: fmt(dd.bias, 6) } : {}) };
}
